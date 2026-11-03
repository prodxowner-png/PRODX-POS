import assert from 'node:assert/strict';
import test from 'node:test';
import { readFirstTenantBootstrapConfig } from './first-tenant-bootstrap';

const validEnvironment = {
  PRODX_FIRST_TENANT_BOOTSTRAP_SECRET: 'test-bootstrap-secret-with-more-than-32-bytes',
  PRODX_FIRST_TENANT_BOOTSTRAP_SUBJECT: '00000000-0000-4000-8000-000000000001',
  PRODX_FIRST_TENANT_ORGANIZATION_CODE: ' PRODX ',
  PRODX_FIRST_TENANT_ORGANIZATION_NAME: 'PRODX Organization',
  PRODX_FIRST_TENANT_STORE_CODE: 'STR-01',
  PRODX_FIRST_TENANT_STORE_NAME: 'สำนักงานใหญ่',
  PRODX_FIRST_TENANT_STORE_TIMEZONE: 'Asia/Bangkok',
  PRODX_FIRST_TENANT_OWNER_USERNAME: 'owner@example.invalid',
  PRODX_FIRST_TENANT_OWNER_DISPLAY_NAME: 'First Owner',
  PRODX_FIRST_TENANT_DEVICE_KEY: 'ADMIN-CONSOLE',
  PRODX_FIRST_TENANT_DEVICE_NAME: 'Administrator Console',
};

test('first-tenant bootstrap config is disabled unless every server-owned value is valid', () => {
  assert.equal(readFirstTenantBootstrapConfig({}), null);
  assert.equal(readFirstTenantBootstrapConfig({
    ...validEnvironment,
    PRODX_FIRST_TENANT_BOOTSTRAP_SECRET: 'too-short',
  }), null);
  assert.equal(readFirstTenantBootstrapConfig({
    ...validEnvironment,
    PRODX_FIRST_TENANT_BOOTSTRAP_SUBJECT: 'not-a-uuid',
  }), null);
  assert.equal(readFirstTenantBootstrapConfig({
    ...validEnvironment,
    PRODX_FIRST_TENANT_STORE_TIMEZONE: '',
  }), null);
});

test('first-tenant bootstrap config trims operator values and canonicalizes the allowlisted UUID', () => {
  const config = readFirstTenantBootstrapConfig(validEnvironment);
  assert.deepEqual(config, {
    secret: validEnvironment.PRODX_FIRST_TENANT_BOOTSTRAP_SECRET,
    supabaseUserId: '00000000-0000-4000-8000-000000000001',
    organizationCode: 'PRODX',
    organizationName: 'PRODX Organization',
    storeCode: 'STR-01',
    storeName: 'สำนักงานใหญ่',
    businessTimezone: 'Asia/Bangkok',
    ownerUsername: 'owner@example.invalid',
    ownerDisplayName: 'First Owner',
    deviceKey: 'ADMIN-CONSOLE',
    deviceName: 'Administrator Console',
  });
});
