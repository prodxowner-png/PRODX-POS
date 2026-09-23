import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createApp } from '../http/createApp';
import { AIGatewayService } from './gateway';
import { installAIHttpRoute } from './http-route';

const principal = { userId: 'user-1', organizationId: 'org-1', storeId: 'store-1' };

const start = async (app: ReturnType<typeof createApp>) => {
  const server = await new Promise<import('node:http').Server>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
};

function makeApp(authenticate: () => typeof principal | null, allowed: boolean) {
  const gateway = new AIGatewayService(
    { get: () => ({ name: 'gemini', chat: async (request) => ({
      provider: 'gemini', model: request.model ?? 'gemini-3.8-flash',
      choices: [{ message: { role: 'assistant', content: 'ok' } }], raw: {},
    }) }) },
    { authorize: () => allowed },
    { record: () => undefined },
    { permission: 'ai:use' },
  );
  return createApp({
    authenticateRequest: authenticate,
    authorizeRequest: () => allowed,
    configureRoutes: (configuredApp) => {
      const router = express.Router();
      installAIHttpRoute(router, { gateway, permission: 'ai:use' });
      configuredApp.use('/api/v1/ai', router);
    },
  });
}

test('AI route is wired at /api/v1/ai/chat and rejects unauthenticated requests', async () => {
  const server = await start(makeApp(() => null, true));
  try {
    const response = await fetch(`${server.baseUrl}/api/v1/ai/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
    });
    assert.equal(response.status, 401);
  } finally { await server.close(); }
});

test('AI route enforces ai:use before provider execution', async () => {
  const server = await start(makeApp(() => principal, false));
  try {
    const response = await fetch(`${server.baseUrl}/api/v1/ai/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
    });
    assert.equal(response.status, 403);
  } finally { await server.close(); }
});

test('AI route returns a successful authenticated Gemini response', async () => {
  const server = await start(makeApp(() => principal, true));
  try {
    const response = await fetch(`${server.baseUrl}/api/v1/ai/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
    });
    assert.equal(response.status, 200);
    const body = await response.json() as { provider: string; requestId: string };
    assert.equal(body.provider, 'gemini');
    assert.equal(body.requestId, response.headers.get('x-request-id'));
  } finally { await server.close(); }
});
