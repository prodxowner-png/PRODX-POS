import assert from 'node:assert/strict';
import test from 'node:test';
import { createGmailService } from './gmailService';

test('Gmail OAuth uses a configured Google client and only metadata/send scopes', async () => {
  let tokenCallback: ((response: { access_token?: string; error?: string }) => void) | undefined;
  let clientConfig: { client_id: string; scope: string } | undefined;
  let profileUrl = '';
  let profileAuthorization = '';
  const service = createGmailService({
    getClientId: () => 'google-client-id.apps.googleusercontent.com',
    loadGoogleIdentity: async () => ({
      accounts: { oauth2: {
        initTokenClient: (options) => {
          clientConfig = options as any;
          tokenCallback = options.callback;
          return { requestAccessToken: () => tokenCallback?.({ access_token: 'google-access-token' }) };
        },
        revoke: (_token, callback) => callback?.(),
      } },
    }),
    fetcher: async (input, init) => {
      profileUrl = String(input);
      profileAuthorization = new Headers(init?.headers).get('authorization') || '';
      return new Response(JSON.stringify({ emailAddress: 'staff@example.test', messagesTotal: 12 }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    },
  });

  const signedIn = await service.signInWithGmail();
  assert.equal(clientConfig?.client_id, 'google-client-id.apps.googleusercontent.com');
  assert.deepEqual(clientConfig?.scope.split(' ').sort(), [
    'https://www.googleapis.com/auth/gmail.metadata',
    'https://www.googleapis.com/auth/gmail.send',
  ]);
  assert.equal(signedIn.accessToken, 'google-access-token');
  assert.equal(signedIn.user.uid, 'staff@example.test');
  assert.equal(signedIn.user.email, 'staff@example.test');
  assert.equal(signedIn.user.displayName, null);
  assert.equal(profileUrl, 'https://gmail.googleapis.com/gmail/v1/users/me/profile');
  assert.equal(profileAuthorization, 'Bearer google-access-token');
  assert.equal(service.getGmailAccessToken(), 'google-access-token');
});

test('Gmail OAuth fails closed when no approved Google client ID is configured', async () => {
  const service = createGmailService({ getClientId: () => undefined });
  await assert.rejects(service.signInWithGmail(), /VITE_GOOGLE_OAUTH_CLIENT_ID/);
});

test('Gmail OAuth fails closed when Gmail profile response has no email address', async () => {
  const service = createGmailService({
    getClientId: () => 'client-id',
    loadGoogleIdentity: async () => ({ accounts: { oauth2: {
      initTokenClient: (options) => ({ requestAccessToken: () => options.callback({ access_token: 'token' }) }),
      revoke: (_token, callback) => callback?.(),
    } } }),
    fetcher: async () => new Response(JSON.stringify({ messagesTotal: 12 }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }),
  });

  await assert.rejects(service.signInWithGmail(), /did not contain an email address/);
  assert.equal(service.getGmailAccessToken(), null);
});

test('Gmail message listing caps user-provided page size and sends bearer token', async () => {
  let requestUrl = '';
  let authorization = '';
  const service = createGmailService({
    getClientId: () => 'client-id',
    loadGoogleIdentity: async () => ({ accounts: { oauth2: {
      initTokenClient: () => ({ requestAccessToken: () => undefined }),
      revoke: (_token, callback) => callback?.(),
    } } }),
    fetcher: async (input, init) => {
      requestUrl = String(input);
      authorization = new Headers(init?.headers).get('authorization') || '';
      return new Response(JSON.stringify({ messages: [{ id: 'message-1' }] }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    },
  });

  const result = await service.listGmailMessages('token', 500);
  assert.equal(requestUrl, 'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=50');
  assert.equal(authorization, 'Bearer token');
  assert.equal(result.messages?.length, 1);
});

test('Gmail API 401 invalidates the cached OAuth session', async () => {
  let revoked = false;
  const service = createGmailService({
    getClientId: () => 'client-id',
    loadGoogleIdentity: async () => ({ accounts: { oauth2: {
      initTokenClient: (options) => ({ requestAccessToken: () => options.callback({ access_token: 'token' }) }),
      revoke: (_token, callback) => { revoked = true; callback?.(); },
    } } }),
    fetcher: async (input) => String(input).includes('/users/me/profile')
      ? new Response(JSON.stringify({ emailAddress: 'user@example.test' }), { status: 200, headers: { 'content-type': 'application/json' } })
      : new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } }),
  });
  await service.signInWithGmail();
  await assert.rejects(service.listGmailMessages('token'), /401/);
  assert.equal(service.getGmailAccessToken(), null);
  assert.equal(revoked, true);
});

test('sendGmailMessage prevents CR/LF header injection and encodes subject', async () => {
  let requestBody: any;
  const service = createGmailService({
    getClientId: () => 'client-id',
    loadGoogleIdentity: async () => ({ accounts: { oauth2: {
      initTokenClient: () => ({ requestAccessToken: () => undefined }),
      revoke: (_token, callback) => callback?.(),
    } } }),
    fetcher: async (input, init) => {
      requestBody = JSON.parse(init?.body as string);
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  await service.sendGmailMessage('token', 'test\r\nBcc: evil@example.com', 'Sub\r\nject', 'body');
  
  const rawDecoded = decodeURIComponent(escape(atob(requestBody.raw.replace(/-/g, '+').replace(/_/g, '/'))));
  assert.match(rawDecoded, /To: testBcc: evil@example\.com/);
  assert.match(rawDecoded, /Subject: =\?utf-8\?B\?U3ViamVjdA==\?=/);
});
