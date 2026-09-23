import assert from 'node:assert/strict';
import test from 'node:test';
import { AiService, AI_BACKEND_CHAT_PATH, DEFAULT_AI_CONFIG } from './aiService';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  readonly length = 0;
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(_index: number): string | null { return null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

test('AiService sends the verified session bearer token to the backend AI route', async () => {
  const storage = new MemoryStorage();
  storage.setItem('prodx_pos_session', JSON.stringify({
    token: 'session-token-123',
    expiresAt: '2099-01-01T00:00:00.000Z',
  }));

  const originalLocalStorage = (globalThis as any).localStorage;
  const originalFetch = globalThis.fetch;
  (globalThis as any).localStorage = storage;

  let captured: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => {
    captured = init;
    return new Response(JSON.stringify({
      choices: [{ message: { content: 'ok' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const service = AiService.getInstance();
    const reply = await service.chatCompletion([{ role: 'user', content: 'Hello' }]);
    assert.equal(reply, 'ok');
    assert.equal(String(captured?.headers && (captured.headers as Record<string, string>).Authorization), 'Bearer session-token-123');
    assert.equal(String(captured?.body).includes('session-token-123'), false);
  } finally {
    globalThis.fetch = originalFetch;
    (globalThis as any).localStorage = originalLocalStorage;
  }
});

test('AiService does not fabricate an Authorization bearer when no session exists', async () => {
  const storage = new MemoryStorage();
  const originalLocalStorage = (globalThis as any).localStorage;
  const originalFetch = globalThis.fetch;
  (globalThis as any).localStorage = storage;

  let captured: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => {
    captured = init;
    return new Response(JSON.stringify({
      choices: [{ message: { content: 'ok' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const service = AiService.getInstance();
    service.saveConfig(DEFAULT_AI_CONFIG);
    const reply = await service.chatCompletion([{ role: 'user', content: 'Hello' }]);
    assert.equal(reply, 'ok');
    const headers = captured?.headers as Record<string, string>;
    assert.equal(Object.prototype.hasOwnProperty.call(headers, 'Authorization'), false);
    assert.equal(AI_BACKEND_CHAT_PATH, '/api/v1/ai/chat');
  } finally {
    globalThis.fetch = originalFetch;
    (globalThis as any).localStorage = originalLocalStorage;
  }
});
