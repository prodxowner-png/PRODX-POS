export interface OwnerAuditUser {
  id: string;
  app_metadata?: Record<string, unknown> | null;
  factors?: Array<{ factor_type?: string; status?: string }> | null;
}

export interface OwnerAuditAuthClient {
  auth: {
    getUser(jwt: string): Promise<{
      data: { user: OwnerAuditUser | null };
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

export interface OwnerAuditAdminClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

export interface OwnerAuditEvent {
  event_id: string;
  occurred_at: string;
  event_type: string;
  actor_user_id: string | null;
  outcome: string | null;
  reason_code: string | null;
  source: string;
}

export interface OwnerAuditDependencies {
  getEnv: (name: string) => string | undefined;
  createAuthClient: (url: string, publishableKey: string) => OwnerAuditAuthClient;
  createAdminClient: (url: string, serviceRoleKey: string) => OwnerAuditAdminClient;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "600",
  "Vary": "Origin",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AUTH_EVENT_TYPES = new Set([
  "auth.login",
  "auth.logout",
  "auth.factor_in_progress",
  "auth.factor_unenrolled",
  "auth.challenge_created",
  "auth.verification_attempted",
  "auth.factor_deleted",
  "auth.factor_updated",
  "auth.mfa_code_login",
  "auth.generate_recovery_codes",
  "auth.recovery_codes_deleted",
]);
const OWNER_EVENT_TYPES = new Set([
  "owner.authorization.denied",
  "owner.role.provisioned",
  "owner.role.revoked",
]);
const OUTCOMES = new Set(["denied", "success"]);
const REASONS = new Set([
  "owner_role_required",
  "aal2_required",
  "invalid_session",
  "authorization_unavailable",
  "admin_provision",
  "admin_revoke",
]);
const SOURCES = new Set(["supabase_auth", "server_verified", "trusted_admin"]);

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
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  return new Response(JSON.stringify(body), { status, headers });
}

function hasVerifiedTotpFactor(user: OwnerAuditUser): boolean {
  return Array.isArray(user.factors) &&
    user.factors.some((factor) =>
      factor.factor_type === "totp" && factor.status === "verified"
    );
}

function sanitizeEvents(value: unknown): OwnerAuditEvent[] {
  if (!Array.isArray(value)) return [];
  const events: OwnerAuditEvent[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue;
    const row = candidate as Record<string, unknown>;
    if (
      typeof row.event_id !== "string" ||
      !UUID_PATTERN.test(row.event_id) ||
      typeof row.occurred_at !== "string" ||
      !Number.isFinite(Date.parse(row.occurred_at)) ||
      typeof row.event_type !== "string" ||
      (!AUTH_EVENT_TYPES.has(row.event_type) && !OWNER_EVENT_TYPES.has(row.event_type)) ||
      typeof row.source !== "string" ||
      !SOURCES.has(row.source)
    ) continue;

    const actorUserId = typeof row.actor_user_id === "string" &&
        UUID_PATTERN.test(row.actor_user_id)
      ? row.actor_user_id
      : null;
    const outcome = typeof row.outcome === "string" && OUTCOMES.has(row.outcome)
      ? row.outcome
      : null;
    const reasonCode = typeof row.reason_code === "string" && REASONS.has(row.reason_code)
      ? row.reason_code
      : null;

    events.push({
      event_id: row.event_id,
      occurred_at: new Date(row.occurred_at).toISOString(),
      event_type: row.event_type,
      actor_user_id: actorUserId,
      outcome,
      reason_code: reasonCode,
      source: row.source,
    });
  }
  return events;
}

export function createOwnerAuditHandler(deps: OwnerAuditDependencies) {
  return async function handleOwnerAudit(req: Request): Promise<Response> {
    const allowedOrigins = new Set(
      (deps.getEnv("OWNER_CONSOLE_ORIGINS") ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter((value) => {
          if (!value || value.includes("*")) return false;
          try {
            const parsed = new URL(value);
            return (parsed.protocol === "https:" ||
              (parsed.protocol === "http:" &&
                (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1"))) &&
              parsed.origin === value;
          } catch {
            return false;
          }
        }),
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
    if (req.method !== "GET") {
      return jsonResponse(405, { error: "method_not_allowed" }, origin);
    }

    const url = deps.getEnv("SUPABASE_URL")?.trim();
    const publishableKey = (
      deps.getEnv("SUPABASE_ANON_KEY") ??
      deps.getEnv("SUPABASE_PUBLISHABLE_KEY")
    )?.trim();
    const serviceRoleKey = deps.getEnv("SUPABASE_SERVICE_ROLE_KEY")?.trim();
    if (!url || !publishableKey || !serviceRoleKey) {
      return jsonResponse(503, { error: "audit_not_configured" }, origin);
    }

    const token = req.headers.get("Authorization")
      ?.match(/^Bearer\s+(\S+)$/i)?.[1];
    if (!token) return jsonResponse(401, { error: "unauthorized" }, origin);

    const requestedLimit = new URL(req.url).searchParams.get("limit");
    const limit = requestedLimit === null ? 100 : Number(requestedLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      return jsonResponse(400, { error: "invalid_limit" }, origin);
    }

    try {
      const authClient = deps.createAuthClient(url, publishableKey);
      const { data: userData, error: userError } = await authClient.auth.getUser(token);
      const user = userData?.user;
      if (userError || !user) {
        return jsonResponse(401, { error: "invalid_session" }, origin);
      }
      if (user.app_metadata?.owner_role !== "owner") {
        return jsonResponse(403, { error: "owner_role_required" }, origin);
      }
      if (!hasVerifiedTotpFactor(user)) {
        return jsonResponse(403, { error: "aal2_required" }, origin);
      }

      const { data: aalData, error: aalError } =
        await authClient.auth.mfa.getAuthenticatorAssuranceLevel(token);
      if (aalError || aalData?.currentLevel !== "aal2") {
        return jsonResponse(403, { error: "aal2_required" }, origin);
      }

      const adminClient = deps.createAdminClient(url, serviceRoleKey);
      const { data, error } = await adminClient.rpc(
        "owner_security_audit_feed",
        { p_limit: limit },
      );
      if (error) return jsonResponse(503, { error: "audit_unavailable" }, origin);

      return jsonResponse(200, { events: sanitizeEvents(data) }, origin);
    } catch {
      return jsonResponse(503, { error: "audit_unavailable" }, origin);
    }
  };
}
