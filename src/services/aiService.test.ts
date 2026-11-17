import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { transformSync } from 'esbuild';
import test from 'node:test';
import {
  AI_BACKEND_CHAT_PATH,
  AiService,
  DEFAULT_AI_CONFIG,
  aiService,
} from './aiService';

function installMemoryStorage(): () => void {
  const store = new Map<string, string>();
  const previous = (globalThis as { localStorage?: Storage }).localStorage;
  const memoryStorage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  } as Storage;

  (globalThis as { localStorage?: Storage }).localStorage = memoryStorage;
  return () => {
    if (previous === undefined) {
      delete (globalThis as { localStorage?: Storage }).localStorage;
    } else {
      (globalThis as { localStorage?: Storage }).localStorage = previous;
    }
  };
}

test('AI_BACKEND_CHAT_PATH resolves to /api/v1/ai/chat and aiService initializes cleanly', () => {
  assert.equal(AI_BACKEND_CHAT_PATH, '/api/v1/ai/chat');
  assert.equal(aiService, AiService.getInstance());

  const restoreStorage = installMemoryStorage();
  try {
    assert.deepEqual(aiService.getConfig(), DEFAULT_AI_CONFIG);
  } finally {
    restoreStorage();
  }
});

test('aiService strips forbidden credential keys from localStorage config', () => {
  const restoreStorage = installMemoryStorage();
  try {
    localStorage.setItem(
      'prodx_ai_service_config',
      JSON.stringify({
        model: 'gemini-3.8-flash',
        enabled: true,
        temperature: 0.4,
        apiKey: 'AIzaSyFakeKey',
        endpoint: 'https://generativelanguage.googleapis.com',
        baseUrl: 'https://api.openai.com',
        authorization: 'Bearer secret',
        token: 'secret-token',
      }),
    );

    const config = aiService.getConfig();
    assert.deepEqual(config, {
      model: 'gemini-3.8-flash',
      enabled: true,
      temperature: 0.4,
    });

    const persisted = JSON.parse(localStorage.getItem('prodx_ai_service_config') ?? '{}');
    for (const forbidden of ['apiKey', 'endpoint', 'baseUrl', 'authorization', 'token']) {
      assert.equal(forbidden in persisted, false, `forbidden key ${forbidden} must be stripped`);
    }
  } finally {
    restoreStorage();
  }
});

test('chatCompletion and askFrontendAssistant retain Bearer token and credentials: include', async () => {
  const restoreStorage = installMemoryStorage();
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; headers: Headers; credentials: RequestCredentials | undefined }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    requests.push({
      url,
      headers: new Headers(init?.headers),
      credentials: init?.credentials,
    });
    if (url === AI_BACKEND_CHAT_PATH) {
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'Chat reply OK' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(
      JSON.stringify({ response: 'Assistant reply OK' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;

  try {
    aiService.setSessionToken('session-token-123');

    const chatReply = await aiService.chatCompletion([{ role: 'user', content: 'สรุปยอดขาย' }]);
    assert.equal(chatReply, 'Chat reply OK');

    const assistantReply = await aiService.askFrontendAssistant('ช่วยตรวจสอบสต็อก');
    assert.equal(assistantReply, 'Assistant reply OK');

    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, AI_BACKEND_CHAT_PATH);
    assert.equal(requests[0].headers.get('authorization'), 'Bearer session-token-123');
    assert.equal(requests[0].credentials, 'include');

    assert.equal(requests[1].url, '/api/v1/ai/frontend-assistant');
    assert.equal(requests[1].headers.get('authorization'), 'Bearer session-token-123');
    assert.equal(requests[1].credentials, 'include');
  } finally {
    aiService.setSessionToken(null);
    globalThis.fetch = originalFetch;
    restoreStorage();
  }
});

test('aiService fails closed on missing token, 401 unauthorized, and 403 forbidden', async () => {
  const restoreStorage = installMemoryStorage();
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;

  try {
    aiService.setSessionToken(null);
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    await assert.rejects(
      aiService.chatCompletion([{ role: 'user', content: 'hello' }]),
      /กรุณาเข้าสู่ระบบก่อนใช้งานผู้ช่วย AI/,
    );
    await assert.rejects(
      aiService.askFrontendAssistant('hello'),
      /กรุณาเข้าสู่ระบบก่อนใช้งานผู้ช่วย AI/,
    );
    assert.equal(fetchCalled, false);

    aiService.setSessionToken('expired-or-unauthorized-token');
    globalThis.fetch = (async () => new Response('Unauthorized', { status: 401 })) as typeof fetch;
    await assert.rejects(
      aiService.chatCompletion([{ role: 'user', content: 'hello' }]),
      /กรุณาเข้าสู่ระบบก่อนใช้งานผู้ช่วย AI/,
    );
    await assert.rejects(
      aiService.askFrontendAssistant('hello'),
      /กรุณาเข้าสู่ระบบก่อนใช้งานผู้ช่วย AI/,
    );

    globalThis.fetch = (async () => new Response('Forbidden', { status: 403 })) as typeof fetch;
    await assert.rejects(
      aiService.chatCompletion([{ role: 'user', content: 'hello' }]),
      /บัญชีของคุณไม่มีสิทธิ์ ai:use สำหรับผู้ช่วย AI/,
    );
    await assert.rejects(
      aiService.askFrontendAssistant('hello'),
      /บัญชีของคุณไม่มีสิทธิ์ ai:use สำหรับผู้ช่วย AI/,
    );
  } finally {
    aiService.setSessionToken(null);
    globalThis.fetch = originalFetch;
    restoreStorage();
  }
});

test('production bundle retains AI_BACKEND_CHAT_PATH and excludes AI provider credentials', () => {
  const assetsDir = join(process.cwd(), 'dist', 'assets');
  if (!existsSync(assetsDir)) {
    return;
  }

  const jsFiles = readdirSync(assetsDir).filter((file) => file.endsWith('.js'));
  assert.ok(jsFiles.length > 0, 'Expected emitted JS chunks in dist/assets');

  const indexChunks = jsFiles.filter((file) => /^index-.*\.js$/.test(file));
  assert.ok(indexChunks.length > 0, 'Expected entry index-*.js chunk in dist/assets');

  const indexWithAiPath = indexChunks.some((file) =>
    readFileSync(join(assetsDir, file), 'utf8').includes(AI_BACKEND_CHAT_PATH),
  );
  assert.equal(
    indexWithAiPath,
    true,
    `Expected ${AI_BACKEND_CHAT_PATH} to be retained in production entry chunk (not stripped by dead-code elimination)`,
  );

  const forbiddenPatterns = [
    /GEMINI_API_KEY/,
    /OPENAI_API_KEY/,
    /ANTHROPIC_API_KEY/,
    /sk-proj-[0-9A-Za-z_-]{20,}/,
    /generativelanguage\.googleapis\.com/,
    /api\.openai\.com/,
    /api\.anthropic\.com/,
    /@google\/genai/,
  ];

  for (const file of jsFiles) {
    const content = readFileSync(join(assetsDir, file), 'utf8');
    for (const pattern of forbiddenPatterns) {
      assert.equal(
        pattern.test(content),
        false,
        `Production bundle ${file} must never contain AI provider credential or endpoint pattern ${pattern}`,
      );
    }
  }
});

test('production bundle entry chunks parse and link with zero missing export errors', () => {
  const assetsDir = join(process.cwd(), 'dist', 'assets');
  if (!existsSync(assetsDir)) {
    return;
  }

  const jsFiles = readdirSync(assetsDir).filter((file) => file.endsWith('.js'));
  const indexChunks = jsFiles.filter((file) => /^index-.*\.js$/.test(file));
  assert.ok(indexChunks.length > 0, 'Expected entry index-*.js chunk in dist/assets');

  for (const chunk of indexChunks) {
    const code = readFileSync(join(assetsDir, chunk), 'utf8');
    assert.doesNotThrow(() => {
      transformSync(code, { loader: 'js' });
    }, `Production chunk ${chunk} must not have syntax or missing-export errors`);
  }
});
