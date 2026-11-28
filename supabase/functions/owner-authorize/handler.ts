export interface OwnerAuthFactor {
  factor_type?: string;
  status?: string;
}

export interface OwnerAuthUser {
  id: string;
  email?: string | null;
  app_metadata?: Record<string, unknown> | null;
  factors?: OwnerAuthFactor[] | null;
}

export interface OwnerAuthClient {
  auth: {
    getUser(jwt: string): Promise<{
      data: { user: OwnerAuthUser | null };
      error: unknown;
    }>;
    mfa: {
      getAuthenticatorAssuranceLevel(jwt: string): Promise<{
        data: { currentLevel: string | null } | null;
        error: unknown;
      }>;
    };
  };
}

export interface OwnerAuthorizationDenial {
  actorUserId: string | null;
  reasonCode:
    | "owner_role_required"
    | "aal2_required"
    | "invalid_session"
    | "authorization_unavailable";
}

export interface OwnerAuthorizeDependencies {
  getEnv: (name: string) => string | undefined;
  createAuthClient: (url: string, publishableKey: string) => OwnerAuthClient;
  recordDenied?: (event: OwnerAuthorizationDenial) => Promise<void>;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "600",
  "Vary": "Origin",
};

export function parseAllowedOrigins(raw: string | undefined): Set<string> {
  const allowed = new Set<string>();
  if (!raw) return allowed;

  for (const part of raw.split(",")) {
    const candidate = part.trim();
    if (!candidate || candidate.includes("*")) continue;
    try {
      const parsed = new URL(candidate);
      const isHttps = parsed.protocol === "https:";
      const isLocalHttp =
        parsed.protocol === "http:" &&
        (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
      if ((isHttps || isLocalHttp) && parsed.origin === candidate) {
        allowed.add(candidate);
      }
    } catch {
      // Ignore malformed origin entries; never widen allowlist.
    }
  }

  return allowed;
}

function jsonResponse(
  status: number,
  body: Record<string, unknown>,
  origin?: string,
): Response {
  const headers = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    ...CORS_HEADERS,
  });
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function hasVerifiedTotpFactor(user: OwnerAuthUser): boolean {
  if (!Array.isArray(user.factors)) return false;
  return user.factors.some(
    (factor) => factor.factor_type === "totp" && factor.status === "verified",
  );
}

export function createOwnerAuthorizeHandler(deps: OwnerAuthorizeDependencies) {
  return async function handleOwnerAuthorize(req: Request): Promise<Response> {
    const recordDenial = async (
      status: number,
      reasonCode: OwnerAuthorizationDenial["reasonCode"],
      actorUserId: string | null,
      origin?: string,
    ) => {
      try {
        await deps.recordDenied?.({ actorUserId, reasonCode });
      } catch {
        // Audit write failure must never turn a denial into an authorization grant.
      }
      return jsonResponse(status, { error: reasonCode }, origin);
    };

    const allowedOrigins = parseAllowedOrigins(
      deps.getEnv("OWNER_CONSOLE_ORIGINS"),
    );
    if (allowedOrigins.size === 0) {
      return jsonResponse(503, { error: "cors_not_configured" });
    }

    const origin = req.headers.get("Origin");
    if (!origin || !allowedOrigins.has(origin)) {
      return jsonResponse(403, { error: "origin_not_allowed" });
    }

    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...CORS_HEADERS,
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": origin,
        },
      });
    }

    if (req.method !== "POST") {
      return jsonResponse(405, { error: "method_not_allowed" }, origin);
    }

    const url = deps.getEnv("SUPABASE_URL")?.trim();
    const publishableKey = (
      deps.getEnv("SUPABASE_ANON_KEY") ??
      deps.getEnv("SUPABASE_PUBLISHABLE_KEY")
    )?.trim();
    if (!url || !publishableKey) {
      return jsonResponse(503, { error: "auth_not_configured" }, origin);
    }

    const token = req.headers
      .get("Authorization")
      ?.match(/^Bearer\s+(\S+)$/i)?.[1];
    if (!token) {
      return jsonResponse(401, { error: "unauthorized" }, origin);
    }

    let actorUserId: string | null = null;
    try {
      const client = deps.createAuthClient(url, publishableKey);
      const { data: userData, error: userError } = await client.auth.getUser(
        token,
      );
      if (userError || !userData?.user) {
        return await recordDenial(401, "invalid_session", null, origin);
      }
      actorUserId = userData.user.id;

      if (userData.user.app_metadata?.owner_role !== "owner") {
        return await recordDenial(403, "owner_role_required", actorUserId, origin);
      }

      if (!hasVerifiedTotpFactor(userData.user)) {
        return await recordDenial(403, "aal2_required", actorUserId, origin);
      }

      const { data: aalData, error: aalError } =
        await client.auth.mfa.getAuthenticatorAssuranceLevel(token);
      if (aalError || aalData?.currentLevel !== "aal2") {
        return await recordDenial(403, "aal2_required", actorUserId, origin);
      }

      return jsonResponse(
        200,
        {
          authorized: true,
          user: {
            id: userData.user.id,
            email: userData.user.email ?? null,
          },
          assuranceLevel: aalData.currentLevel,
        },
        origin,
      );
    } catch {
      return await recordDenial(503, "authorization_unavailable", actorUserId, origin);
    }
  };
}
