import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { registerInfrastructureRoutes } from './infrastructureRoutes.ts';

async function withServer(
  authorize: (permission: string) => Promise<boolean>,
  run: (baseUrl: string) => Promise<void>,
  ociStatusProvider?: Parameters<typeof registerInfrastructureRoutes>[2],
) {
  const app = express();
  app.use((request, _response, next) => {
    request.id = 'oci-route-test';
    request.prodxContext = {
      requestId: request.id,
      principal: { subject: 'test-user' },
    } as never;
    next();
  });
  app.locals.prodxAuthorize = async (_context: unknown, permission: string) => authorize(permission);
  registerInfrastructureRoutes(app, undefined, ociStatusProvider ?? (async () => ({
    ok: true,
    status: {
      name: 'posproductionapp',
      homeRegionKey: 'SIN',
      lifecycleState: 'ACTIVE',
      timeCreated: null,
      integration: 'read-only',
      checkedAt: '2026-11-12T00:00:00.000Z',
      latencyMs: 12.3,
    },
  })));
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port.');
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('OCI tenancy infrastructure endpoint requires settings.manage and returns no-store metadata', async () => {
  let authorizedPermission = '';
  await withServer(async (permission) => {
    authorizedPermission = permission;
    return true;
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/infrastructure/oci/tenancy`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json() as { success: boolean; data: { name: string; homeRegionKey: string; integration: string } };
    assert.equal(body.success, true);
    assert.equal(body.data.name, 'posproductionapp');
    assert.equal(body.data.homeRegionKey, 'SIN');
    assert.equal(body.data.integration, 'read-only');
  });
  assert.equal(authorizedPermission, 'settings.manage');
});

test('OCI tenancy infrastructure endpoint denies callers without settings.manage', async () => {
  await withServer(async () => false, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/infrastructure/oci/tenancy`);
    assert.equal(response.status, 403);
    const body = await response.json() as { error: { code: string } };
    assert.equal(body.error.code, 'FORBIDDEN');
  });
});

  
test('OCI tenancy infrastructure endpoint returns the standard API error envelope on bridge failure', async () => {
  await withServer(async () => true, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/infrastructure/oci/tenancy`);
    assert.equal(response.status, 503);
    const body = await response.json() as { error: { code: string; message: string; requestId: string } };
    assert.equal(body.error.code, 'OCI_BRIDGE_NOT_CONFIGURED');
    assert.equal(body.error.message, 'OCI tenancy status is unavailable.');
    assert.equal(body.error.requestId, 'oci-route-test');
  }, async () => ({
    ok: false,
    statusCode: 503,
    code: 'OCI_BRIDGE_NOT_CONFIGURED',
  }));
});
