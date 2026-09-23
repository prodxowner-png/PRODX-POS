import assert from 'node:assert/strict';
import test from 'node:test';
import { GeminiProvider } from './geminiProvider';

test('GeminiProvider sends authenticated Gemini generateContent requests', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({
      responseId: 'gemini-response',
      modelVersion: 'gemini-3.8-flash',
      candidates: [{ content: { parts: [{ text: 'hello from gemini' }] } }],
      usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4, totalTokenCount: 7 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const provider = new GeminiProvider({
      apiKey: 'test-gemini-key',
      defaultModel: 'gemini-3.8-flash',
      timeoutMs: 5_000,
    });
    const result = await provider.chat({
      messages: [
        { role: 'system', content: 'You are a POS assistant.' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
      ],
      temperature: 0.2,
      max_tokens: 100,
    });

    assert.equal(result.provider, 'gemini');
    assert.equal(result.choices?.[0] && (result.choices[0] as any).message.content, 'hello from gemini');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
    assert.equal((calls[0].init?.headers as Record<string, string>)['x-goog-api-key'], 'test-gemini-key');
    const body = JSON.parse(String(calls[0].init?.body));
    assert.equal(body.systemInstruction.parts[0].text, 'You are a POS assistant.');
    assert.equal(body.contents[0].role, 'user');
    assert.equal(body.contents[1].role, 'model');
    assert.equal(body.generationConfig.maxOutputTokens, 100);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GeminiProvider rejects non-Gemini model identifiers', async () => {
  const provider = new GeminiProvider({ apiKey: 'test-gemini-key' });
  await assert.rejects(
    provider.chat({ model: 'openrouter/auto-beta', messages: [{ role: 'user', content: 'Hello' }] }),
    /Only Gemini models are allowed/,
  );
});
