import assert from 'node:assert/strict';
import test from 'node:test';
import type { SessionContext } from '../domain/auth';
import { startSessionRenewalController } from './sessionRenewalController';

class FakeScheduler {
  now = 1_000;
  private nextId = 1;
  private tasks = new Map<number, { at: number; callback: () => void }>();
  schedule = (callback: () => void, delay: number): ReturnType<typeof setTimeout> => {
    const id = this.nextId++;
    this.tasks.set(id, { at: this.now + delay, callback });
    return id as unknown as ReturnType<typeof setTimeout>;
  };
  cancel = (handle: ReturnType<typeof setTimeout>): void => {
    this.tasks.delete(handle as unknown as number);
  };
  async advance(milliseconds: number): Promise<void> {
    const target = this.now + milliseconds;
    while (true) {
      const due = [...this.tasks.entries()]
        .filter(([, task]) => task.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [id, task] = due;
      this.tasks.delete(id);
      this.now = task.at;
      task.callback();
      await flushMicrotasks();
    }
    this.now = target;
    await flushMicrotasks();
  }
  get pendingCount(): number { return this.tasks.size; }
}

const flushMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

const session = (token: string, expiresAt: string): SessionContext => ({ token, expiresAt } as SessionContext);

test('unchanged renewal expiry schedules logout at the existing server expiry', async () => {
  const clock = new FakeScheduler();
  const expiry = new Date(clock.now + 120_000).toISOString();
  const logouts: string[] = [];
  let renewals = 0;
  const stop = startSessionRenewalController({
    token: 'pos-token', expiresAt: expiry, getActiveToken: () => 'pos-token',
    renew: async () => { renewals += 1; return session('pos-token', expiry); },
    onRenewed: () => assert.fail('unchanged expiry must not be accepted as an extension'),
    logout: async (token) => { logouts.push(token); },
    now: () => clock.now, schedule: clock.schedule, cancel: clock.cancel,
  });
  await clock.advance(60_000);
  assert.equal(renewals, 1);
  assert.equal(clock.pendingCount, 1);
  await clock.advance(59_999);
  assert.deepEqual(logouts, []);
  await clock.advance(1);
  assert.deepEqual(logouts, ['pos-token']);
  stop();
});

test('extended server expiry is applied once and hands scheduling back to AuthContext', async () => {
  const clock = new FakeScheduler();
  const expiry = new Date(clock.now + 120_000).toISOString();
  const extended = new Date(clock.now + 240_000).toISOString();
  const applied: SessionContext[] = [];
  const logouts: string[] = [];
  const stop = startSessionRenewalController({
    token: 'pos-token', expiresAt: expiry, getActiveToken: () => 'pos-token',
    renew: async () => session('pos-token', extended),
    onRenewed: (renewed) => applied.push(renewed),
    logout: async (token) => { logouts.push(token); },
    now: () => clock.now, schedule: clock.schedule, cancel: clock.cancel,
  });
  await clock.advance(60_000);
  assert.equal(applied.length, 1);
  assert.equal(applied[0].expiresAt, extended);
  assert.deepEqual(logouts, []);
  assert.equal(clock.pendingCount, 0);
  stop();
});

test('stale successful renewal is ignored after a replacement login', async () => {
  const clock = new FakeScheduler();
  const expiry = new Date(clock.now + 120_000).toISOString();
  let activeToken = 'old-token';
  let resolveRenewal!: (value: SessionContext | null) => void;
  const applied: SessionContext[] = [];
  const logouts: string[] = [];
  const stop = startSessionRenewalController({
    token: 'old-token', expiresAt: expiry, getActiveToken: () => activeToken,
    renew: () => new Promise((resolve) => { resolveRenewal = resolve; }),
    onRenewed: (renewed) => applied.push(renewed),
    logout: async (token) => { logouts.push(token); },
    now: () => clock.now, schedule: clock.schedule, cancel: clock.cancel,
  });
  const advancing = clock.advance(60_000);
  await flushMicrotasks();
  activeToken = 'replacement-token';
  resolveRenewal(session('old-token', new Date(clock.now + 240_000).toISOString()));
  await advancing;
  await flushMicrotasks();
  assert.deepEqual(applied, []);
  assert.deepEqual(logouts, []);
  stop();
});

test('stale 401 from an old renewal cannot log out a replacement session', async () => {
  const clock = new FakeScheduler();
  const expiry = new Date(clock.now + 120_000).toISOString();
  let activeToken = 'old-token';
  let rejectRenewal!: (error: Error & { status: number }) => void;
  const logouts: string[] = [];
  const stop = startSessionRenewalController({
    token: 'old-token', expiresAt: expiry, getActiveToken: () => activeToken,
    renew: () => new Promise((_resolve, reject) => { rejectRenewal = reject; }),
    onRenewed: () => assert.fail('rejected renewal cannot update the session'),
    logout: async (token) => { logouts.push(token); },
    now: () => clock.now, schedule: clock.schedule, cancel: clock.cancel,
  });
  const advancing = clock.advance(60_000);
  await flushMicrotasks();
  activeToken = 'replacement-token';
  rejectRenewal(Object.assign(new Error('unauthorized'), { status: 401 }));
  await advancing;
  await flushMicrotasks();
  assert.deepEqual(logouts, []);
  stop();
});

test('transient renewal failures retry only while the captured POS session remains current', async () => {
  const clock = new FakeScheduler();
  const expiry = new Date(clock.now + 120_000).toISOString();
  const failures: Array<{ status: number | null; errorName: string }> = [];
  let activeToken = 'pos-token';
  let attempts = 0;
  const logouts: string[] = [];
  const stop = startSessionRenewalController({
    token: 'pos-token', expiresAt: expiry, getActiveToken: () => activeToken,
    renew: async () => { attempts += 1; throw Object.assign(new Error('sensitive message'), { status: 503 }); },
    onRenewed: () => assert.fail('failed renewal cannot update the session'),
    logout: async (token) => { logouts.push(token); },
    onTransientError: (failure) => failures.push(failure),
    now: () => clock.now, schedule: clock.schedule, cancel: clock.cancel,
  });
  await clock.advance(60_000);
  assert.equal(attempts, 1);
  assert.deepEqual(failures, [{ status: 503, errorName: 'Error' }]);
  activeToken = 'replacement-token';
  await clock.advance(30_000);
  assert.equal(attempts, 1);
  assert.deepEqual(logouts, []);
  stop();
});
