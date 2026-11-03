import assert from 'node:assert/strict';
import test from 'node:test';
import { createPostgresPool, resolveConfiguredDatabaseUrl } from '../db/postgres';
import { createTransactionalPostgresExecutor } from '../db/transaction';
import {
  createTimeclockService,
  TimeclockAuthenticationError,
  TimeclockConflictError,
  TimeclockLockedError,
} from './timeclock-service';

const databaseUrl = resolveConfiguredDatabaseUrl(process.env.DATABASE_URL);
const pepper = 'integration-test-pepper';

const ids = {
  organization: '00000000-0000-4000-8000-000000000901',
  storeA: '00000000-0000-4000-8000-000000000911',
  storeB: '00000000-0000-4000-8000-000000000912',
  operator: '00000000-0000-4000-8000-000000000921',
  employee: '00000000-0000-4000-8000-000000000922',
};

const context = {
  organizationId: ids.organization,
  storeId: ids.storeA,
  userId: ids.operator,
};

test('timeclock PostgreSQL integration proves idempotency, lockout persistence, concurrency, and store isolation', async (t) => {
  if (!databaseUrl) {
    t.skip('DATABASE_URL is not configured; run server:test with PostgreSQL.');
    return;
  }

  process.env.TIMECLOCK_PIN_PEPPER = pepper;

  const pool = createPostgresPool();
  const db = createTransactionalPostgresExecutor(pool);
  const service = createTimeclockService(db);

  const resetFixture = async () => {
    await pool.query('DELETE FROM prodx_timeclock_operations WHERE organization_id=$1', [ids.organization]);
    await pool.query('DELETE FROM prodx_timeclock_records WHERE organization_id=$1', [ids.organization]);
    await pool.query('DELETE FROM prodx_timeclock_credentials WHERE organization_id=$1', [ids.organization]);
    await pool.query('DELETE FROM prodx_timeclock_auth_attempts WHERE organization_id=$1', [ids.organization]);
    await pool.query(
      `INSERT INTO prodx_organizations (id, code, name)
       VALUES ($1,$2,$3)
       ON CONFLICT(id) DO UPDATE SET code=EXCLUDED.code,name=EXCLUDED.name`,
      [ids.organization, 'timeclock-it', 'Timeclock Integration'],
    );
    await pool.query(
      `INSERT INTO prodx_stores (id, organization_id, code, name, business_timezone)
       VALUES ($1,$3,'timeclock-a','Timeclock Store A','Asia/Bangkok'),
              ($2,$3,'timeclock-b','Timeclock Store B','Asia/Bangkok')
       ON CONFLICT(id) DO UPDATE SET organization_id=EXCLUDED.organization_id,
                                     code=EXCLUDED.code,
                                     name=EXCLUDED.name,
                                     business_timezone=EXCLUDED.business_timezone`,
      [ids.storeA, ids.storeB, ids.organization],
    );
    await pool.query(
      `INSERT INTO prodx_users (id, organization_id, username, display_name, status)
       VALUES ($1,$3,'timeclock-operator','Timeclock Operator','active'),
              ($2,$3,'timeclock-employee','Timeclock Employee','active')
       ON CONFLICT(id) DO UPDATE SET organization_id=EXCLUDED.organization_id,
                                     username=EXCLUDED.username,
                                     display_name=EXCLUDED.display_name,
                                     status='active'`,
      [ids.operator, ids.employee, ids.organization],
    );
    await pool.query(
      `INSERT INTO prodx_store_memberships (organization_id, store_id, user_id) VALUES
        ($1,$2,$3), ($1,$2,$4), ($1,$5,$3), ($1,$5,$4)
       ON CONFLICT(organization_id,store_id,user_id) DO UPDATE SET active=TRUE`,
      [ids.organization, ids.storeA, ids.operator, ids.employee, ids.storeB],
    );
  };

  try {
    await resetFixture();

    await service.provisionPin(context, ids.employee, '1234');

    const first = await service.clockIn(context, '1234', 'pg-clock-in-1');
    const replay = await service.clockIn(context, '1234', 'pg-clock-in-1');
    assert.equal(replay.id, first.id);

    await assert.rejects(
      service.clockIn(context, '1234', 'pg-clock-in-2'),
      TimeclockConflictError,
    );

    await service.clockOut(context, '1234', 'pg-clock-out-1');
    const clockOutReplay = await service.clockOut(context, '1234', 'pg-clock-out-1');
    assert.equal(clockOutReplay.id, first.id);

    const concurrent = await Promise.allSettled([
      service.clockIn(context, '1234', 'pg-concurrent-a'),
      service.clockIn(context, '1234', 'pg-concurrent-b'),
    ]);
    assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(
      concurrent.filter(
        (result) => result.status === 'rejected' && result.reason instanceof TimeclockConflictError,
      ).length,
      1,
    );

    await service.clockOut(context, '1234', 'pg-clock-out-2');

    await resetFixture();
    await service.provisionPin(context, ids.employee, '1234');

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await assert.rejects(
        service.clockIn(context, '9999', 'pg-bad-pin-' + attempt),
        TimeclockAuthenticationError,
      );
    }
    await assert.rejects(
      service.clockIn(context, '9999', 'pg-bad-pin-4'),
      TimeclockLockedError,
    );
    await assert.rejects(
      service.clockIn(context, '1234', 'pg-after-lock'),
      TimeclockLockedError,
    );

    await resetFixture();
    await service.provisionPin(context, ids.employee, '1234');
    const concurrentFailures = await Promise.allSettled(
      Array.from({ length: 5 }, (_, index) =>
        service.clockIn(context, '9999', 'pg-concurrent-bad-pin-' + index),
      ),
    );
    assert.equal(
      concurrentFailures.filter(
        (result) => result.status === 'rejected' && result.reason instanceof TimeclockAuthenticationError,
      ).length,
      4,
    );
    assert.equal(
      concurrentFailures.filter(
        (result) => result.status === 'rejected' && result.reason instanceof TimeclockLockedError,
      ).length,
      1,
    );
    await assert.rejects(
      service.clockIn(context, '1234', 'pg-after-concurrent-lock'),
      TimeclockLockedError,
    );

    await resetFixture();
    await service.provisionPin(context, ids.employee, '1234');
    await assert.rejects(
      service.clockIn({ ...context, storeId: ids.storeB }, '1234', 'pg-cross-store'),
      TimeclockAuthenticationError,
    );

    const recordsA = await service.getRecords(context);
    const recordsB = await service.getRecords({ ...context, storeId: ids.storeB });
    assert.equal(recordsA.length, 0);
    assert.equal(recordsB.length, 0);
  } finally {
    await resetFixture();
    await pool.end();
  }
});
