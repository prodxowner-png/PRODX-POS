import assert from 'node:assert/strict';
import test from 'node:test';
import { VercelGatewayProvider } from './vercelGatewayProvider';

test('Vercel Gateway provider rejects client-selected models outside the server allowlist', async () => {
  const provider = new VercelGatewayProvider({
    defaultModel: 'google/gemini-3.8-flash',
    allowedModels: ['google/gemini-3.8-flash'],
  });

  await assert.rejects(
    provider.chat({ model: 'openai/gpt-6-astra', messages: [{ role: 'user', content: 'hello' }] }),
    /not allowed by server policy/,
  );
});

test('Vercel Gateway provider rejects invalid request limits before network execution', async () => {
  const provider = new VercelGatewayProvider();
  await assert.rejects(
    provider.chat({ max_tokens: 2_001, messages: [{ role: 'user', content: 'hello' }] }),
    /between 1 and 2000/,
  );
  await assert.rejects(
    provider.chat({ temperature: 2.1, messages: [{ role: 'user', content: 'hello' }] }),
    /temperature must be between 0 and 2/,
  );
});

test('Vercel Gateway provider aborts stalled upstream requests within the configured timeout', async () => {
  let observedSignal: AbortSignal | undefined;
  const previousGatewayKey = process.env.AI_GATEWAY_API_KEY;
  process.env.AI_GATEWAY_API_KEY = 'test-gateway-key';
  const provider = new VercelGatewayProvider({
    defaultModel: 'google/gemini-3.8-flash',
    allowedModels: ['google/gemini-3.8-flash'],
    timeoutMs: 1_000,
    fetch: async (_input, init) => {
      observedSignal = init?.signal as AbortSignal | undefined;
      return await new Promise<Response>((_resolve, reject) => {
        observedSignal?.addEventListener('abort', () => reject(observedSignal?.reason), { once: true });
      });
    },
  });

  try {
    await assert.rejects(
      provider.chat({ messages: [{ role: 'user', content: 'hello' }] }),
      /AI Gateway request timed out after 1000ms/,
    );
    assert.equal(observedSignal?.aborted, true);
  } finally {
    if (previousGatewayKey === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = previousGatewayKey;
  }
});
