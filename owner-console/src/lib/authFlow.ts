const OWNER_AUTH_PROJECT_ORIGIN = 'https://tohgadyunmsfcopaldvz.supabase.co';

export type OwnerAuthState =
  | 'loading'
  | 'signed-out'
  | 'mfa-enroll'
  | 'mfa-challenge'
  | 'signed-in'
  | 'denied'
  | 'misconfigured';

export interface OwnerUserLike {
  id: string;
  email?: string | null;
  app_metadata?: Record<string, unknown> | null;
}

export interface OwnerSessionLike {
  access_token: string;
  user: OwnerUserLike;
}

export interface OwnerTotpFactorLike {
  id: string;
  status: string;
  factor_type?: string;
}

export interface OwnerSupabaseClientLike {
  auth: {
    getUser(jwt: string): Promise<{
      data: { user: OwnerUserLike | null };
      error: unknown;
    }>;
    signOut(options?: { scope?: 'global' | 'local' | 'others' }): Promise<{
      error: unknown;
    }>;
    mfa: {
      getAuthenticatorAssuranceLevel(jwt: string): Promise<{
        data: { currentLevel: string | null } | null;
        error: unknown;
      }>;
      listFactors(): Promise<{
        data: {
          totp: OwnerTotpFactorLike[];
          all?: OwnerTotpFactorLike[];
        } | null;
        error: unknown;
      }>;
      enroll(params: {
        factorType: 'totp';
        friendlyName: string;
      }): Promise<{
        data: {
          id: string;
          totp: {
            qr_code: string;
            secret?: string;
          };
        } | null;
        error: unknown;
      }>;
      unenroll(params: { factorId: string }): Promise<{
        data: unknown;
        error: unknown;
      }>;
    };
  };
  functions: {
    invoke<T = unknown>(
      functionName: string,
      options?: { headers?: Record<string, string> },
    ): Promise<{ data: T | null; error: unknown }>;
  };
}

export type SessionEvaluationResult<TSession extends OwnerSessionLike = OwnerSessionLike> =
  | { state: 'signed-out' }
  | { state: 'mfa-enroll' }
  | { state: 'mfa-challenge'; factorId: string }
  | { state: 'signed-in'; session: TSession }
  | { state: 'denied'; error: string };

export function isValidOwnerSupabaseConfig(
  url: string | undefined,
  publishableKey: string | undefined,
): boolean {
  const trimmedUrl = url?.trim();
  const trimmedKey = publishableKey?.trim();
  if (!trimmedUrl || !trimmedKey) return false;

  // Defense-in-depth: never accept secret/service-role keys in browser config.
  if (trimmedKey.startsWith('sb_secret_')) return false;
  const jwtParts = trimmedKey.split('.');
  if (jwtParts.length === 3) {
    try {
      const normalized = jwtParts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
      const payloadJson = globalThis.atob(padded);
      const payload = JSON.parse(payloadJson) as { role?: unknown };
      if (payload.role === 'service_role') return false;
    } catch {
      // Non-JWT or undecodable segment; allow publishable key formats.
    }
  }

  try {
    const parsed = new URL(trimmedUrl);
    // The Owner Console must never send credentials to the POS Auth project or an
    // arbitrary HTTPS endpoint. Only the dedicated Owner Auth origin is valid in
    // deployed environments; loopback remains available for local Supabase testing.
    const isCanonicalOrigin =
      parsed.origin === trimmedUrl &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash &&
      parsed.pathname === '/';
    if (!isCanonicalOrigin) return false;

    const isDedicatedOwnerAuth =
      parsed.protocol === 'https:' &&
      parsed.origin === OWNER_AUTH_PROJECT_ORIGIN;
    const isLocalDevelopment =
      parsed.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    return isDedicatedOwnerAuth || isLocalDevelopment;
  } catch {
    return false;
  }
}

export function hasOwnerRole(user: OwnerUserLike): boolean {
  return user.app_metadata?.owner_role === 'owner';
}

export function normalizeTotpQrCodeSrc(rawQrCode: string): string {
  const trimmed = rawQrCode.trim();
  if (!trimmed) return '';

  const utf8SvgPrefix = /^data:image\/svg\+xml;utf-8,/i;
  if (utf8SvgPrefix.test(trimmed)) {
    const payload = trimmed.replace(utf8SvgPrefix, '');
    if (!payload) return '';
    if (payload.startsWith('%3C') || payload.startsWith('%3c')) {
      return `data:image/svg+xml;charset=utf-8,${payload}`;
    }
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(payload)}`;
  }

  if (
    /^data:image\/svg\+xml;(charset=utf-8,|base64,)/i.test(trimmed) ||
    /^data:image\/png;base64,/i.test(trimmed)
  ) {
    return trimmed;
  }

  if (trimmed.startsWith('<svg')) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(trimmed)}`;
  }

  return '';
}

export async function evaluateOwnerSession<TSession extends OwnerSessionLike>(
  client: OwnerSupabaseClientLike,
  session: TSession | null,
): Promise<SessionEvaluationResult<TSession>> {
  if (!session) {
    return { state: 'signed-out' };
  }

  try {
    const [
      { data: userData, error: userError },
      { data: aalData, error: aalError },
    ] = await Promise.all([
      client.auth.getUser(session.access_token),
      client.auth.mfa.getAuthenticatorAssuranceLevel(session.access_token),
    ]);

    if (userError || !userData?.user || aalError || !aalData) {
      return {
        state: 'denied',
        error: 'ไม่สามารถยืนยัน Owner identity หรือ MFA ได้',
      };
    }

    if (!hasOwnerRole(userData.user)) {
      return {
        state: 'denied',
        error: 'บัญชีนี้ยังไม่ได้รับสิทธิ์ Owner',
      };
    }

    if (aalData.currentLevel !== 'aal2') {
      const { data: factorData, error: factorError } =
        await client.auth.mfa.listFactors();
      if (factorError || !factorData) {
        return {
          state: 'denied',
          error: 'ตรวจสอบ MFA factors ไม่สำเร็จ',
        };
      }

      const verified = factorData.totp.find(
        (factor) => factor.status === 'verified',
      );
      if (verified) {
        return { state: 'mfa-challenge', factorId: verified.id };
      }
      return { state: 'mfa-enroll' };
    }

    const { data: authorization, error: authorizationError } =
      await client.functions.invoke<{
        authorized?: boolean;
        assuranceLevel?: string;
      }>('owner-authorize', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

    if (
      authorizationError ||
      authorization?.authorized !== true ||
      authorization.assuranceLevel !== 'aal2'
    ) {
      return {
        state: 'denied',
        error:
          'Server ไม่สามารถยืนยัน Owner authorization ได้ จึงปฏิเสธการเข้าใช้งาน',
      };
    }

    return { state: 'signed-in', session };
  } catch {
    return {
      state: 'denied',
      error: 'ไม่สามารถตรวจสอบสิทธิ์ Owner กับเซิร์ฟเวอร์ได้ จึงปฏิเสธการเข้าใช้งาน',
    };
  }
}

export async function enrollOwnerTotp(client: OwnerSupabaseClientLike): Promise<{
  factorId: string;
  qrCodeSrc: string;
  secret: string;
}> {
  const { data: factorData, error: listError } =
    await client.auth.mfa.listFactors();
  if (listError) {
    throw listError;
  }

  const candidateFactors = factorData?.all ?? factorData?.totp ?? [];
  const staleUnverifiedTotp = candidateFactors.filter(
    (factor) =>
      factor.status === 'unverified' &&
      (factor.factor_type === undefined || factor.factor_type === 'totp'),
  );

  for (const stale of staleUnverifiedTotp) {
    const { error: unenrollError } = await client.auth.mfa.unenroll({
      factorId: stale.id,
    });
    if (unenrollError) {
      throw unenrollError;
    }
  }

  const { data, error: enrollError } = await client.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'PRODX Owner Authenticator',
  });
  if (enrollError || !data) {
    throw enrollError ?? new Error('TOTP enrollment failed');
  }

  const qrCodeSrc = normalizeTotpQrCodeSrc(data.totp.qr_code);
  if (!qrCodeSrc) {
    throw new Error('Invalid TOTP QR code format');
  }

  return {
    factorId: data.id,
    qrCodeSrc,
    secret: data.totp.secret ?? '',
  };
}

export async function signOutOwner(
  client: OwnerSupabaseClientLike,
): Promise<{ remoteRevoked: boolean }> {
  try {
    const { error } = await client.auth.signOut();
    if (!error) {
      return { remoteRevoked: true };
    }
  } catch {
    // Fall through to local sign-out so browser state is always cleared.
  }

  try {
    await client.auth.signOut({ scope: 'local' });
  } catch {
    // Fail closed in UI regardless of storage/network errors.
  }
  return { remoteRevoked: false };
}
