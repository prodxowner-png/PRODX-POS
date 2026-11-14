import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PRODX_ORG_URL = 'https://wcyqyiewbzpmrekoljfw.supabase.co';
const PRODUCTION_ORIGIN = 'https://prodx-pos.vercel.app';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type BootstrapEnvironment = {
  supabaseUrl: string;
  publishableKey: string;
  bootstrapSecret: string;
  bootstrapSubject: string;
};

// This is only a local allowlist preflight. The Production route independently verifies the JWT signature, issuer, audience, and expiry.\nexport const decodeSupabaseJwtSubject = (token: string): string => {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) {
    throw new Error('Supabase returned an invalid access token.');
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new Error('Supabase returned an unreadable access token.');
  }

  if (!payload || typeof payload !== 'object' || !('sub' in payload)
      || typeof payload.sub !== 'string' || !UUID_PATTERN.test(payload.sub)) {
    throw new Error('Supabase access token does not contain a valid subject UUID.');
  }

  return payload.sub;
};

export const validateBootstrapEnvironment = (
  env: Record<string, string | undefined>,
): BootstrapEnvironment => {
  const supabaseUrl = env.VITE_SUPABASE_URL?.trim() ?? '';
  const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';
  const bootstrapSecret = env.PRODX_FIRST_TENANT_BOOTSTRAP_SECRET ?? '';
  const bootstrapSubject = env.PRODX_FIRST_TENANT_BOOTSTRAP_SUBJECT?.trim() ?? '';

  let normalizedUrl = '';
  try {
    normalizedUrl = new URL(supabaseUrl).origin;
  } catch {
    throw new Error('VITE_SUPABASE_URL is missing or invalid in the bootstrap environment file.');
  }

  if (normalizedUrl !== PRODX_ORG_URL) {
    throw new Error('The bootstrap environment does not point to the approved PRODX-ORG Auth project.');
  }
  if (!publishableKey.startsWith('sb_publishable_')) {
    throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY is missing or is not a publishable key.');
  }
  if (bootstrapSecret.length < 32) {
    throw new Error('PRODX_FIRST_TENANT_BOOTSTRAP_SECRET must contain at least 32 characters.');
  }
  if (!UUID_PATTERN.test(bootstrapSubject)) {
    throw new Error('PRODX_FIRST_TENANT_BOOTSTRAP_SUBJECT is missing or is not a valid UUID.');
  }

  return { supabaseUrl: normalizedUrl, publishableKey, bootstrapSecret, bootstrapSubject };
};

const promptLine = async (label: string): Promise<string> => {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await new Promise<string>((resolveQuestion) => {
      readline.question(label, resolveQuestion);
    })).trim();
  } finally {
    readline.close();
  }
};

const promptHidden = async (label: string): Promise<string> => {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    throw new Error('Run this command in an interactive terminal so the password is not echoed.');
  }

  process.stdout.write(label);
  input.setRawMode(true);
  input.resume();

  return new Promise<string>((resolveQuestion, rejectQuestion) => {
    let value = '';
    const cleanup = () => {
      input.off('data', onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write('\n');
    };
    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') {
          cleanup();
          rejectQuestion(new Error('Cancelled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          cleanup();
          resolveQuestion(value);
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        if (character >= ' ') value += character;
      }
    };
    input.on('data', onData);
  });
};

const run = async (): Promise<void> => {
  const envFile = process.env.PRODX_BOOTSTRAP_ENV_FILE || '.env.bootstrap';
  const loaded = loadEnv({ path: envFile, override: true });
  if (loaded.error) {
    throw new Error(`Could not load ${envFile}. Run Vercel env pull for the Production project first.`);
  }

  const config = validateBootstrapEnvironment(process.env);
  const email = await promptLine('PRODX-ORG Auth email: ');
  if (!email) throw new Error('An Auth email is required.');

  let password = await promptHidden('Password (hidden): ');
  if (!password) throw new Error('A password is required.');

  const supabase = createClient(config.supabaseUrl, config.publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    password = '';
    if (error || !data.session?.access_token) {
      throw new Error('Supabase Auth sign-in failed. Verify the account credentials and email/password provider settings.');
    }

    const accessToken = data.session.access_token;
    const subject = decodeSupabaseJwtSubject(accessToken);
    if (subject.toLowerCase() !== config.bootstrapSubject.toLowerCase()) {
      throw new Error('The signed-in Auth identity is not the configured first-tenant bootstrap subject. No bootstrap request was sent.');
    }

    const endpoint = new URL('/auth/supabase/bootstrap', PRODUCTION_ORIGIN);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'x-prodx-bootstrap-secret': config.bootstrapSecret,
        'content-type': 'application/json',
      },
      body: '{}',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });

    const body = await response.json().catch(() => null) as {
      error?: { code?: string };
      currentUser?: { role?: string };
    } | null;

    if (!response.ok) {
      const code = body?.error?.code ?? `HTTP_${response.status}`;
      if (response.status === 404) {
        throw new Error('Production bootstrap endpoint is not configured (404). No tenant was created.');
      }
      if (response.status === 401) {
        throw new Error('Bootstrap authorization failed (401). Verify the configured Auth subject and operator secret.');
      }
      throw new Error(`First-tenant bootstrap failed: ${code}.`);
    }

    if (body?.currentUser?.role !== 'admin') {
      throw new Error('Bootstrap returned success without the required Owner/Admin session context. Stop and investigate.');
    }

    console.log('First-tenant bootstrap succeeded.');
    console.log('The server returned the tenant, store, and Owner/Admin session context.');
    console.log('No access token or POS bearer token was printed or written to disk.');
  } finally {
    password = '';
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
  }
};

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  : false;

if (isMain) {
  void run().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown bootstrap error.';
    console.error(message);
    process.exitCode = 1;
  });
}
