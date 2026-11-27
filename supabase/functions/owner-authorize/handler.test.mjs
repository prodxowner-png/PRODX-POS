import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createOwnerAuthorizeHandler,
  parseAllowedOrigins,
} from "./handler.ts";

const ALLOWED_ORIGIN = "https://owner-console.example.com";

function makeDeps(overrides = {}) {
  const env = {
    OWNER_CONSOLE_ORIGINS: ALLOWED_ORIGIN,
    SUPABASE_URL: "https://tohgadyunmsfcopaldvz.supabase.co",
    SUPABASE_ANON_KEY: "sb_publishable_test_key",
    ...(overrides.env ?? {}),
  };

  const defaultClient = {
    auth: {
      async getUser() {
        return {
          data: {
            user: {
              id: "owner-user-1",
              email: "owner@example.com",
              app_metadata: { owner_role: "owner" },
              factors: [{ factor_type: "totp", status: "verified" }],
            },
          },
          error: null,
        };
      },
      mfa: {
        async getAuthenticatorAssuranceLevel() {
          return { data: { currentLevel: "aal2" }, error: null };
        },
      },
    },
  };

  const denials = [];
  return {
    denials,
    getEnv: (name) => env[name],
    createAuthClient: overrides.createAuthClient ?? (() => defaultClient),
    recordDenied: overrides.recordDenied ?? (async (event) => { denials.push(event); }),
  };
}

describe("parseAllowedOrigins", () => {
  it("accepts exact https and localhost origins and rejects wildcards or paths", () => {
    const origins = parseAllowedOrigins(
      "https://owner.example.com, http://localhost:5173, *, https://evil.example.com/path, https://bad.example.com/, http://insecure.example.com, https://*.example.com",
    );
    assert.deepEqual(
      [...origins].sort(),
      ["http://localhost:5173", "https://owner.example.com"],
    );
  });
});

describe("owner-authorize Edge Function handler", () => {
  it("fails closed with 503 when OWNER_CONSOLE_ORIGINS is missing", async () => {
    const handler = createOwnerAuthorizeHandler(
      makeDeps({ env: { OWNER_CONSOLE_ORIGINS: "" } }),
    );
    const res = await handler(
      new Request("https://edge.local/owner-authorize", {
        method: "POST",
        headers: { Origin: ALLOWED_ORIGIN },
      }),
    );
    assert.equal(res.status, 503);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), null);
    assert.equal(res.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await res.json(), { error: "cors_not_configured" });
  });

  it("fails closed with 503 when OWNER_CONSOLE_ORIGINS contains only wildcard", async () => {
    const handler = createOwnerAuthorizeHandler(
      makeDeps({ env: { OWNER_CONSOLE_ORIGINS: "*" } }),
    );
    const res = await handler(
      new Request("https://edge.local/owner-authorize", {
        method: "POST",
        headers: { Origin: ALLOWED_ORIGIN },
      }),
    );
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: "cors_not_configured" });
  });

  it("denies missing or untrusted Origin with 403 and no ACAO header", async () => {
    const handler = createOwnerAuthorizeHandler(makeDeps());

    const noOrigin = await handler(
      new Request("https://edge.local/owner-authorize", { method: "POST" }),
    );
    assert.equal(noOrigin.status, 403);
    assert.equal(noOrigin.headers.get("Access-Control-Allow-Origin"), null);

    const evilOrigin = await handler(
      new Request("https://edge.local/owner-authorize", {
        method: "POST",
        headers: { Origin: `${ALLOWED_ORIGIN}.evil.com` },
      }),
    );
    assert.equal(evilOrigin.status, 403);
    assert.equal(evilOrigin.headers.get("Access-Control-Allow-Origin"), null);
    assert.deepEqual(await evilOrigin.json(), { error: "origin_not_allowed" });
  });

  it("handles OPTIONS preflight for exact allowlisted Origin", async () => {
    const handler = createOwnerAuthorizeHandler(makeDeps());
    const res = await handler(
      new Request("https://edge.local/owner-authorize", {
        method: "OPTIONS",
        headers: { Origin: ALLOWED_ORIGIN },
      }),
    );
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), ALLOWED_ORIGIN);
    assert.equal(res.headers.get("Vary"), "Origin");
    assert.equal(res.headers.get("Cache-Control"), "no-store");
  });

  it("rejects non-POST methods with 405", async () => {
    const handler = createOwnerAuthorizeHandler(makeDeps());
    const res = await handler(
      new Request("https://edge.local/owner-authorize", {
        method: "GET",
        headers: { Origin: ALLOWED_ORIGIN },
      }),
    );
    assert.equal(res.status, 405);
    assert.deepEqual(await res.json(), { error: "method_not_allowed" });
  });

  it("returns 503 when SUPABASE_URL or publishable key is missing", async () => {
    const handler = createOwnerAuthorizeHandler(
      makeDeps({ env: { SUPABASE_ANON_KEY: "" } }),
    );
    const res = await handler(
      new Request("https://edge.local/owner-authorize", {
        method: "POST",
        headers: {
          Origin: ALLOWED_ORIGIN,
          Authorization: "Bearer valid.jwt.token",
        },
      }),
    );
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: "auth_not_configured" });
  });

  it("returns 401 when Authorization bearer token is missing", async () => {
    const handler = createOwnerAuthorizeHandler(makeDeps());
    const res = await handler(
      new Request("https://edge.local/owner-authorize", {
        method: "POST",
        headers: { Origin: ALLOWED_ORIGIN },
      }),
    );
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: "unauthorized" });
  });

  it("returns 401 when Supabase rejects an invalid or expired token", async () => {
    const deps = makeDeps({
      createAuthClient: () => ({
        auth: {
          async getUser() {
            return { data: { user: null }, error: { message: "invalid" } };
          },
          mfa: {
            async getAuthenticatorAssuranceLevel() {
              return { data: null, error: null };
            },
          },
        },
      }),
    });
    const handler = createOwnerAuthorizeHandler(deps);
    const res = await handler(
      new Request("https://edge.local/owner-authorize", {
        method: "POST",
        headers: {
          Origin: ALLOWED_ORIGIN,
          Authorization: "Bearer expired-token",
        },
      }),
    );
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: "invalid_session" });
    assert.deepEqual(deps.denials, [{ actorUserId: null, reasonCode: "invalid_session" }]);
  });

  it("returns 403 when authenticated user lacks trusted app_metadata.owner_role", async () => {
    const deps = makeDeps({
        createAuthClient: () => ({
          auth: {
            async getUser() {
              return {
                data: {
                  user: {
                    id: "staff-1",
                    email: "staff@example.com",
                    app_metadata: { owner_role: "staff" },
                    factors: [{ factor_type: "totp", status: "verified" }],
                  },
                },
                error: null,
              };
            },
            mfa: {
              async getAuthenticatorAssuranceLevel() {
                return { data: { currentLevel: "aal2" }, error: null };
              },
            },
          },
        }),
    });
    const handler = createOwnerAuthorizeHandler(deps);
    const res = await handler(
      new Request("https://edge.local/owner-authorize", {
        method: "POST",
        headers: {
          Origin: ALLOWED_ORIGIN,
          Authorization: "Bearer staff-token",
        },
      }),
    );
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: "owner_role_required" });
    assert.deepEqual(deps.denials, [{
      actorUserId: "staff-1",
      reasonCode: "owner_role_required",
    }]);
  });

  it("returns 403 when owner assurance level is AAL1", async () => {
    const deps = makeDeps({
        createAuthClient: () => ({
          auth: {
            async getUser() {
              return {
                data: {
                  user: {
                    id: "owner-1",
                    email: "owner@example.com",
                    app_metadata: { owner_role: "owner" },
                    factors: [{ factor_type: "totp", status: "verified" }],
                  },
                },
                error: null,
              };
            },
            mfa: {
              async getAuthenticatorAssuranceLevel() {
                return { data: { currentLevel: "aal1" }, error: null };
              },
            },
          },
        }),
    });
    const handler = createOwnerAuthorizeHandler(deps);
    const res = await handler(
      new Request("https://edge.local/owner-authorize", {
        method: "POST",
        headers: {
          Origin: ALLOWED_ORIGIN,
          Authorization: "Bearer aal1-token",
        },
      }),
    );
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: "aal2_required" });
    assert.deepEqual(deps.denials, [{
      actorUserId: "owner-1",
      reasonCode: "aal2_required",
    }]);
  });

  it("keeps authorization denied when the audit writer fails", async () => {
    const deps = makeDeps({
      createAuthClient: () => ({
        auth: {
          async getUser() {
            return {
              data: {
                user: {
                  id: "staff-1",
                  app_metadata: { owner_role: "staff" },
                  factors: [{ factor_type: "totp", status: "verified" }],
                },
              },
              error: null,
            };
          },
          mfa: {
            async getAuthenticatorAssuranceLevel() {
              return { data: { currentLevel: "aal2" }, error: null };
            },
          },
        },
      }),
      recordDenied: async () => { throw new Error("database unavailable"); },
    });
    const res = await createOwnerAuthorizeHandler(deps)(
      new Request("https://edge.local/owner-authorize", {
        method: "POST",
        headers: {
          Origin: ALLOWED_ORIGIN,
          Authorization: "Bearer staff-token",
        },
      }),
    );
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: "owner_role_required" });
  });

  it("returns 403 when owner has no active verified TOTP factor", async () => {
    const handler = createOwnerAuthorizeHandler(
      makeDeps({
        createAuthClient: () => ({
          auth: {
            async getUser() {
              return {
                data: {
                  user: {
                    id: "owner-1",
                    email: "owner@example.com",
                    app_metadata: { owner_role: "owner" },
                    factors: [{ factor_type: "totp", status: "unverified" }],
                  },
                },
                error: null,
              };
            },
            mfa: {
              async getAuthenticatorAssuranceLevel() {
                return { data: { currentLevel: "aal2" }, error: null };
              },
            },
          },
        }),
      }),
    );
    const res = await handler(
      new Request("https://edge.local/owner-authorize", {
        method: "POST",
        headers: {
          Origin: ALLOWED_ORIGIN,
          Authorization: "Bearer stale-aal2-token",
        },
      }),
    );
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: "aal2_required" });
  });

  it("fails closed with 503 when upstream auth throws", async () => {
    const handler = createOwnerAuthorizeHandler(
      makeDeps({
        createAuthClient: () => ({
          auth: {
            async getUser() {
              throw new Error("secret upstream failure details");
            },
            mfa: {
              async getAuthenticatorAssuranceLevel() {
                return { data: null, error: null };
              },
            },
          },
        }),
      }),
    );
    const res = await handler(
      new Request("https://edge.local/owner-authorize", {
        method: "POST",
        headers: {
          Origin: ALLOWED_ORIGIN,
          Authorization: "Bearer owner-token",
        },
      }),
    );
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.deepEqual(body, { error: "authorization_unavailable" });
    assert.equal(JSON.stringify(body).includes("secret"), false);
  });

  it("authorizes verified Owner with active TOTP factor and AAL2", async () => {
    const handler = createOwnerAuthorizeHandler(makeDeps());
    const res = await handler(
      new Request("https://edge.local/owner-authorize", {
        method: "POST",
        headers: {
          Origin: ALLOWED_ORIGIN,
          Authorization: "Bearer valid-owner-aal2-token",
        },
      }),
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), ALLOWED_ORIGIN);
    assert.equal(res.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await res.json(), {
      authorized: true,
      user: { id: "owner-user-1", email: "owner@example.com" },
      assuranceLevel: "aal2",
    });
  });
});
