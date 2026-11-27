import assert from 'node:assert/strict';
import test from 'node:test';
import { isProductionApiBaseUrl, resolveProductionApiBaseUrl } from './apiBaseUrl';

test('production API base defaults to same-origin routing when omitted', () => {
  assert.equal(resolveProductionApiBaseUrl(undefined), '');
  assert.equal(resolveProductionApiBaseUrl('   '), '');
});

test('production API base accepts same-origin paths and absolute HTTP(S) origins', () => {
  assert.equal(resolveProductionApiBaseUrl('/'), '');
  assert.equal(resolveProductionApiBaseUrl('/backend/'), '/backend');
  assert.equal(resolveProductionApiBaseUrl('https://api.example.test/'), 'https://api.example.test');
  assert.equal(resolveProductionApiBaseUrl('http://127.0.0.1:4000/'), 'http://127.0.0.1:4000');
});

test('production API base rejects protocol-relative, unsafe schemes, and control characters', () => {
  for (const value of [
    '//evil.example',
    'javascript:alert(1)',
    'data:text/plain,x',
    'https://example.test\n@evil.test',
    'https://user:password@api.example.test',
    'https://api.example.test/base?tenant=untrusted',
    'https://api.example.test/base#fragment',
    '/api?tenant=untrusted',
    '/api#fragment',
  ]) {
    assert.equal(isProductionApiBaseUrl(value), false);
    assert.throws(() => resolveProductionApiBaseUrl(value), /Production API base URL/);
  }
});
