import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createOwnerAuditHandler } from "./handler.ts";

const ORIGIN = "https://owner-console.example.com";
const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const EVENT_ID = "22222222-2222-4222-8222-222222222222";

function makeDeps(overrides = {}) {
  const env = {
    OWNER_CONSOLE_ORIGINS: ORIGIN,
    SUPABASE_URL: "https://owner-auth.example.supabase.co",
    SUPABASE_ANON_KEY: "sb_publishable_test",
    SUPABASE_SERVICE_ROLE_KEY: "server-only-test-secret",
    ...(overrides.env ?? {}),
  };
  const calls = [];
  const defaultAuthClient = {
    auth: {
      async getUser(token) {
        calls.push(["getUser", token]);
        return {
          data: {
            user: {
              id: OWNER_ID,
              app_metadata: { owner_role: "owner" },
              factors: [{ factor_type: "totp", status: "verified" }],
            },
          },
          error: null,
        };
      },
      mfa: {
        async getAuthenticatorAssuranceLevel(token) {
          calls.push(["aal", token]);
          return { data: { currentLevel: "aal2" }, error: null };
        },
      },
    },
  };
  const defaultAdminClient = {
    async rpc(name, args) {
      calls.push(["rpc", name, args]);
      return {
        data: [{
          event_id: EVENT_ID,
          occurred_at: "2026-11-21T08:00:00.000Z",
          event_type: "auth.login",
          actor_user_id: OWNER_ID,
          outcome: null,
          reason_code: null,
          source: "supabase_auth",
          ip_address: "203.0.113.9",
          payload: { password: "must-never-leak" },
        }],
        error: null,
      };
    },
  };
  return {
    calls,
    getEnv: (name) => env[name],
    createAuthClient: overrides.createAuthClient ?? (() => defaultAuthClient),
    createAdminClient: overrides.createAdminClient ?? (() => defaultAdminClient),
  };
}

function request({ method = "GET", origin = ORIGIN, token = "owner.jwt.token", url } = {}) {
  const headers = {};
  if (origin) headers.Origin = origin;
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request(url ?? "https://edge.local/owner-audit", { method, headers });
}

describe("owner-audit Edge Function handler", () => {
  it("fails closed when CORS is not configured", async () => {
    const deps = makeDeps({ env: { OWNER_CONSOLE_ORIGINS: "" } });
    const res = await createOwnerAuditHandler(deps)(request());
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: "cors_not_configured" });
    assert.equal(deps.calls.length, 0);
  });

  it("rejects missing and untrusted origins", async () => {
    const handler = createOwnerAuditHandler(makeDeps());
    assert.equal((await handler(request({ origin: null }))).status, 403);
    const evil = await handler(request({ origin: `${ORIGIN}.evil.test` }));
    assert.equal(evil.status, 403);
    assert.equal(evil.headers.get("Access-Control-Allow-Origin"), null);
  });

  it("handles exact-origin preflight", async () => {
    const res = await createOwnerAuditHandler(makeDeps())(request({ method: "OPTIONS" }));
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), ORIGIN);
    assert.equal(res.headers.get("Cache-Control"), "no-store");
  });

  it("allows only GET and OPTIONS", async () => {
    const res = await createOwnerAuditHandler(makeDeps())(request({ method: "POST" }));
    assert.equal(res.status, 405);
    assert.deepEqual(await res.json(), { error: "method_not_allowed" });
  });

  it("requires all server configuration including the service role key", async () => {
    const deps = makeDeps({ env: { SUPABASE_SERVICE_ROLE_KEY: "" } });
    const res = await createOwnerAuditHandler(deps)(request());
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: "audit_not_configured" });
    assert.equal(deps.calls.length, 0);
  });

  it("requires a bearer token", async () => {
    const res = await createOwnerAuditHandler(makeDeps())(request({ token: null }));
    assert.equal(res.status, 401);
  });

  it("rejects invalid sessions", async () => {
    const deps = makeDeps({
      createAuthClient: () => ({
        auth: {
          async getUser() {
            return { data: { user: null }, error: new Error("invalid") };
          },
          mfa: { async getAuthenticatorAssuranceLevel() { throw new Error("not called"); } },
        },
      }),
    });
    const res = await createOwnerAuditHandler(deps)(request());
    assert.equal(res.status, 401);
    assert.equal(deps.calls.length, 0);
  });

  it("rejects users without trusted app_metadata owner role before creating an admin client", async () => {
    let adminCreated = false;
    const deps = makeDeps({
      createAuthClient: () => ({
        auth: {
          async getUser() {
            return {
              data: { user: { id: OWNER_ID, app_metadata: { owner_role: "staff" }, factors: [] } },
              error: null,
            };
          },
          mfa: { async getAuthenticatorAssuranceLevel() { throw new Error("not called"); } },
        },
      }),
      createAdminClient: () => { adminCreated = true; throw new Error("must not be created"); },
    });
    const res = await createOwnerAuditHandler(deps)(request());
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: "owner_role_required" });
    assert.equal(adminCreated, false);
  });

  it("requires a verified TOTP factor and AAL2", async () => {
    const noTotp = makeDeps({
      createAuthClient: () => ({
        auth: {
          async getUser() {
            return { data: { user: { id: OWNER_ID, app_metadata: { owner_role: "owner" }, factors: [] } }, error: null };
          },
          mfa: { async getAuthenticatorAssuranceLevel() { throw new Error("not called"); } },
        },
      }),
    });
    const denied = await createOwnerAuditHandler(noTotp)(request());
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), { error: "aal2_required" });

    const aal1 = makeDeps({
      createAuthClient: () => ({
        auth: {
          async getUser() {
            return { data: { user: { id: OWNER_ID, app_metadata: { owner_role: "owner" }, factors: [{ factor_type: "totp", status: "verified" }] } }, error: null };
          },
          mfa: { async getAuthenticatorAssuranceLevel() { return { data: { currentLevel: "aal1" }, error: null }; } },
        },
      }),
    });
    const aalDenied = await createOwnerAuditHandler(aal1)(request());
    assert.equal(aalDenied.status, 403);
    assert.deepEqual(await aalDenied.json(), { error: "aal2_required" });
  });

  it("validates the requested limit", async () => {
    const deps = makeDeps();
    const res = await createOwnerAuditHandler(deps)(request({ url: "https://edge.local/owner-audit?limit=201" }));
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "invalid_limit" });
    assert.equal(deps.calls.length, 0);
  });

  it("returns only sanitized fields from the server-side audit feed", async () => {
    const deps = makeDeps();
    const res = await createOwnerAuditHandler(deps)(request());
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Cache-Control"), "no-store");
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), ORIGIN);
    const body = await res.json();
    assert.deepEqual(body.events, [{
      event_id: EVENT_ID,
      occurred_at: "2026-11-21T08:00:00.000Z",
      event_type: "auth.login",
      actor_user_id: OWNER_ID,
      outcome: null,
      reason_code: null,
      source: "supabase_auth",
    }]);
    assert.equal(JSON.stringify(body).includes("203.0.113.9"), false);
    assert.equal(JSON.stringify(body).includes("must-never-leak"), false);
    assert.deepEqual(deps.calls.map((call) => call[0]), ["getUser", "aal", "rpc"]);
    assert.equal(deps.calls[2][1], "owner_security_audit_feed");
    assert.equal(deps.calls[2][2].p_limit, 100);
  });

  it("does not expose RPC errors or payload details", async () => {
    const deps = makeDeps({
      createAdminClient: () => ({
        async rpc() { return { data: null, error: { message: "internal SQL detail" } }; },
      }),
    });
    const res = await createOwnerAuditHandler(deps)(request());
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: "audit_unavailable" });
  });

  it("filters unexpected event types and malformed rows", async () => {
    const deps = makeDeps({
      createAdminClient: () => ({
        async rpc() {
          return {
            data: [
              { event_id: EVENT_ID, occurred_at: "2026-11-21T08:00:00Z", event_type: "auth.login", source: "supabase_auth" },
              { event_id: "33333333-3333-4333-8333-333333333333", occurred_at: "2026-11-21T08:00:00Z", event_type: "auth.factor_updated", source: "supabase_auth" },
              { event_id: "44444444-4444-4444-8444-444444444444", occurred_at: "2026-11-21T08:00:00Z", event_type: "auth.unknown", source: "supabase_auth" },
              { event_id: "bad", occurred_at: "yesterday", event_type: "owner.role.provisioned", source: "trusted_admin" },
            ],
            error: null,
          };
        },
      }),
    });
    const res = await createOwnerAuditHandler(deps)(request());
    const body = await res.json();
    assert.equal(body.events.length, 2);
    assert.deepEqual(body.events.map((event) => event.event_type), ["auth.login", "auth.factor_updated"]);
  });
});
