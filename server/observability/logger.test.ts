import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createLogger,
  parseTraceparent,
  redactValue,
  resolveTraceContext,
  safeErrorDiagnostic,
} from './logger.ts';
import { createGracefulShutdownHandler, resolveShutdownTimeoutMs } from './shutdown.ts';

test('createLogger emits single-line structured JSON to stdout for info/debug and stderr for warn/error', () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const fixedDate = new Date('2026-11-23T12:00:00.000Z');
  const log = createLogger({
    writeStdout: (line) => stdout.push(line),
    writeStderr: (line) => stderr.push(line),
    now: () => fixedDate,
  });

  log.info('http.request', {
    requestId: 'req-123',
    traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
    method: 'POST',
    path: '/api/v1/orders/checkout',
    status: 200,
    durationMs: 14.25,
    organizationId: 'org-1',
    storeId: 'store-1',
  });
  log.warn('http.request', { requestId: 'req-124', status: 403 });
  log.error('server.error', { requestId: 'req-125', status: 500 });

  assert.equal(stdout.length, 1);
  assert.equal(stderr.length, 2);

  const infoEntry = JSON.parse(stdout[0]);
  assert.deepEqual(infoEntry, {
    timestamp: '2026-11-23T12:00:00.000Z',
    level: 'info',
    event: 'http.request',
    requestId: 'req-123',
    traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
    method: 'POST',
    path: '/api/v1/orders/checkout',
    status: 200,
    durationMs: 14.25,
    organizationId: 'org-1',
    storeId: 'store-1',
  });
  assert.equal(JSON.parse(stderr[0]).level, 'warn');
  assert.equal(JSON.parse(stderr[1]).level, 'error');
});

test('logger strictly redacts sensitive keys, authorization headers, tokens, and postgres DSNs', () => {
  const stdout: string[] = [];
  const log = createLogger({
    writeStdout: (line) => stdout.push(line),
    writeStderr: () => {},
  });

  log.info('audit.test', {
    authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.secret.sig',
    cookie: 'session=top-secret-cookie',
    password: 'my-plain-password',
    x_prodx_bootstrap_secret: 'bootstrap-secret-value',
    nested: {
      accessToken: 'tok_live_12345',
      apiKey: 'sk_live_98765',
      safeField: 'visible',
    },
    note: 'Failed with Bearer abc.def.ghi on postgresql://user:supersecret@db.internal:5432/prod',
  });

  const serialized = stdout[0];
  assert.equal(serialized.includes('eyJhbGciOiJIUzI1NiJ9'), false);
  assert.equal(serialized.includes('top-secret-cookie'), false);
  assert.equal(serialized.includes('my-plain-password'), false);
  assert.equal(serialized.includes('bootstrap-secret-value'), false);
  assert.equal(serialized.includes('tok_live_12345'), false);
  assert.equal(serialized.includes('sk_live_98765'), false);
  assert.equal(serialized.includes('supersecret'), false);
  assert.equal(serialized.includes('abc.def.ghi'), false);

  const parsed = JSON.parse(serialized);
  assert.equal(parsed.authorization, '[REDACTED]');
  assert.equal(parsed.cookie, '[REDACTED]');
  assert.equal(parsed.password, '[REDACTED]');
  assert.equal(parsed.x_prodx_bootstrap_secret, '[REDACTED]');
  assert.equal(parsed.nested.accessToken, '[REDACTED]');
  assert.equal(parsed.nested.apiKey, '[REDACTED]');
  assert.equal(parsed.nested.safeField, 'visible');
  assert.equal(parsed.note, 'Failed with Bearer [REDACTED] on postgresql://[REDACTED]');
});

test('redactValue handles circular references without throwing', () => {
  const obj: Record<string, unknown> = { ok: true };
  obj.self = obj;
  const redacted = redactValue(obj) as Record<string, unknown>;
  assert.equal(redacted.ok, true);
  assert.equal(redacted.self, '[CIRCULAR]');
});

test('parseTraceparent and resolveTraceContext follow W3C Trace Context rules', () => {
  const valid = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
  const parsed = parseTraceparent(valid);
  assert.deepEqual(parsed, {
    traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
    parentId: '00f067aa0ba902b7',
    traceFlags: '01',
  });

  const resolved = resolveTraceContext(valid);
  assert.equal(resolved.traceId, '4bf92f3577b34da6a3ce929d0e0e4736');
  assert.notEqual(resolved.spanId, '00f067aa0ba902b7');
  assert.match(resolved.traceparent, /^00-4bf92f3577b34da6a3ce929d0e0e4736-[0-9a-f]{16}-01$/);

  assert.equal(parseTraceparent('00-00000000000000000000000000000000-00f067aa0ba902b7-01'), null);
  assert.equal(parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01'), null);
  assert.equal(parseTraceparent('ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'), null);
  assert.equal(parseTraceparent('not-a-traceparent'), null);

  const generated = resolveTraceContext(undefined);
  assert.match(generated.traceparent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
});

test('safeErrorDiagnostic returns only allowlisted fields and omits messages and hostnames', () => {
  const err = Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432'), {
    code: 'ECONNREFUSED',
    syscall: 'connect',
    port: 5432,
    hostname: 'secret.internal',
    stage: 'database_query',
  });
  const diag = safeErrorDiagnostic(err);
  assert.deepEqual(diag, {
    name: 'Error',
    code: 'ECONNREFUSED',
    syscall: 'connect',
    port: 5432,
    stage: 'database_query',
  });
  assert.equal('hostname' in diag, false);
  assert.equal('message' in diag, false);
});

test('graceful shutdown closes server, ends pool, is idempotent, and forces exit on timeout', async () => {
  const events: string[] = [];
  let poolEnded = 0;
  let exitCode: number | null = null;

  const log = createLogger({
    writeStdout: (line) => events.push(JSON.parse(line).event),
    writeStderr: (line) => events.push(JSON.parse(line).event),
  });

  const handler = createGracefulShutdownHandler({
    server: {
      close: (cb) => {
        cb?.();
        return {} as never;
      },
      closeIdleConnections: () => {},
    },
    pool: {
      end: async () => {
        poolEnded += 1;
      },
    },
    timeoutMs: 500,
    log,
    exit: (code) => {
      exitCode = code;
    },
  });

  await Promise.all([handler('SIGTERM'), handler('SIGINT')]);
  assert.equal(poolEnded, 1);
  assert.equal(exitCode, 0);
  assert.deepEqual(events, ['server.shutdown_started', 'server.shutdown_completed']);

  // Verify forced timeout exits with code 1 when server.close hangs
  let timeoutExitCode: number | null = null;
  const timeoutEvents: string[] = [];
  const timeoutLog = createLogger({
    writeStdout: (line) => timeoutEvents.push(JSON.parse(line).event),
    writeStderr: (line) => timeoutEvents.push(JSON.parse(line).event),
  });
  const hangingHandler = createGracefulShutdownHandler({
    server: {
      close: () => ({} as never),
    },
    pool: {
      end: async () => {},
    },
    timeoutMs: 25,
    log: timeoutLog,
    exit: (code) => {
      timeoutExitCode = code;
    },
  });

  void hangingHandler('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(timeoutExitCode, 1);
  assert.deepEqual(timeoutEvents, ['server.shutdown_started', 'server.shutdown_timeout']);

  assert.equal(resolveShutdownTimeoutMs(undefined), 10_000);
  assert.equal(resolveShutdownTimeoutMs('2500'), 2500);
  assert.equal(resolveShutdownTimeoutMs('invalid'), 10_000);
});
