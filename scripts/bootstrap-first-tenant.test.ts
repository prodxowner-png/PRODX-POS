import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeSupabaseJwtSubject,
  validateBootstrapEnvironment,
} from './bootstrap-first-tenant';

const subject = '00000000-0000-4000-8000-000000000015';
const makeToken = (payload: Record<string, unknown>) => {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.unsigned-test-token`;
};

const validEnvironment = () => ({
  VITE_SUPABASE_URL: 'https://wcyqyiewbzpmrekoljfw.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_key',
  PRODX_FIRST_TENANT_BOOTSTRAP_SECRET: 'x'.repeat(40),
  PRODX_FIRST_TENANT_BOOTSTRAP_SUBJECT: subject,
});

test('bootstrap CLI extracts only the JWT subject for local allowlist preflight', () => {
  assert.equal(decodeSupabaseJwtSubject(makeToken({ sub: subject })), subject);
});

test('bootstrap CLI rejects malformed or subject-less JWTs before making a request', () => {
  assert.throws(() => decodeSupabaseJwtSubject('not-a-jwt'), /invalid access token/i);
  assert.throws(() => decodeSupabaseJwtSubject(makeToken({ aud: 'authenticated' })), /valid subject UUID/i);
});

test('bootstrap CLI accepts only the canonical PRODX-ORG project and complete server bootstrap configuration', () => {
  const config = validateBootstrapEnvironment(validEnvironment());
  assert.equal(config.supabaseUrl, 'https://wcyqyiewbzpmrekoljfw.supabase.co');
  assert.equal(config.bootstrapSubject, subject);
  assert.equal(config.bootstrapSecret.length, 40);
});

test('bootstrap CLI rejects a different Supabase issuer', () => {
  assert.throws(() => validateBootstrapEnvironment({
    ...validEnvironment(),
    VITE_SUPABASE_URL: 'https://other-project.supabase.co',
  }), /approved PRODX-ORG/i);
});

test('bootstrap CLI rejects short operator secrets and malformed allowlisted subjects', () => {
  assert.throws(() => validateBootstrapEnvironment({
    ...validEnvironment(),
    PRODX_FIRST_TENANT_BOOTSTRAP_SECRET: 'too-short',
  }), /at least 32 characters/i);
  assert.throws(() => validateBootstrapEnvironment({
    ...validEnvironment(),
    PRODX_FIRST_TENANT_BOOTSTRAP_SUBJECT: 'not-a-uuid',
  }), /valid UUID/i);
});
