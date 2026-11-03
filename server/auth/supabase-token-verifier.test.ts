import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createSupabaseTokenVerifier } from './session';

test('POS Supabase verifier checks issuer, audience, expiry, UUID subject, and JWKS signature without email claims', async (t) => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  const keyId = 'pos-auth-test-key';
  const server = createServer((request, response) => {
    if (request.url !== '/jwks') {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' });
    response.end(JSON.stringify({ keys: [{ ...jwk, kid: keyId, use: 'sig', alg: 'RS256' }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const posUrl = `http://127.0.0.1:${address.port}`;
  const verifySupabaseToken = createSupabaseTokenVerifier(posUrl, `${posUrl}/jwks`);
  const sign = (claims: { issuer?: string; audience?: string; expiration?: number; subject?: string } = {}) => {
    const builder = new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: keyId })
      .setSubject(claims.subject ?? '00000000-0000-4000-8000-000000000099')
      .setIssuer(claims.issuer ?? `${posUrl}/auth/v1`)
      .setAudience(claims.audience ?? 'authenticated');
    return builder.setIssuedAt().setExpirationTime(claims.expiration ?? Math.floor(Date.now() / 1000) + 300).sign(privateKey);
  };

  const valid = await verifySupabaseToken(await sign());
  assert.deepEqual(valid && { userId: valid.userId }, { userId: '00000000-0000-4000-8000-000000000099' });
  assert.ok(valid && valid.expiresAt.getTime() > Date.now());
  assert.equal(await verifySupabaseToken(await sign({ issuer: 'https://attacker.example/auth/v1' })), null);
  assert.equal(await verifySupabaseToken(await sign({ issuer: 'https://owner.example.supabase.co/auth/v1' })), null);
  assert.equal(await createSupabaseTokenVerifier('http://pos-auth.example.test', 'https://pos-auth.example.test/jwks')(await sign()), null);
  assert.equal(await createSupabaseTokenVerifier('https://pos-auth.example.test', `http://127.0.0.1:${address.port}/jwks`)(await sign()), null,
    'remote Auth configuration must reject loopback JWKS');
  assert.equal(await createSupabaseTokenVerifier(posUrl, 'https://attacker.example/jwks')(await sign()), null);
  assert.equal(await verifySupabaseToken(await sign({ audience: 'anon' })), null);
  assert.equal(await verifySupabaseToken(await sign({ subject: 'not-a-uuid' })), null);
  assert.equal(await verifySupabaseToken(await sign({ expiration: Math.floor(Date.now() / 1000) - 10 })), null);
  assert.equal(await verifySupabaseToken('not-a-jwt'), null);
});
