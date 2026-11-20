import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  enrollOwnerTotp,
  evaluateOwnerSession,
  isValidOwnerSupabaseConfig,
  normalizeTotpQrCodeSrc,
  signOutOwner,
} from "../src/lib/authFlow.ts";

function makeServiceRoleJwt() {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url");
  return `${header}.${payload}.sig`;
}

function makeClient(overrides = {}) {
  const invoked = [];
  const unenrolled = [];

  const client = {
    invoked,
    unenrolled,
    auth: {
      async getUser() {
        return {
          data: {
            user: {
              id: "owner-1",
              email: "owner@example.com",
              app_metadata: { owner_role: "owner" },
            },
          },
          error: null,
        };
      },
      async signOut() {
        return { error: null };
      },
      mfa: {
        async getAuthenticatorAssuranceLevel() {
          return { data: { currentLevel: "aal2" }, error: null };
        },
        async listFactors() {
          return { data: { totp: [], all: [] }, error: null };
        },
        async enroll() {
          return {
            data: {
              id: "totp-new-1",
              totp: {
                qr_code: "data:image/svg+xml;utf-8,<svg xmlns=\"http://www.w3.org/2000/svg\"><rect fill=\"#000\"/></svg>",
                secret: "JBSWY3DPEHPK3PXP",
              },
            },
            error: null,
          };
        },
        async unenroll({ factorId }) {
          unenrolled.push(factorId);
          return { data: { id: factorId }, error: null };
        },
      },
    },
    functions: {
      async invoke(name, options) {
        invoked.push({ name, options });
        return { data: { authorized: true, assuranceLevel: "aal2" }, error: null };
      },
    },
  };

  if (overrides.auth) Object.assign(client.auth, overrides.auth);
  if (overrides.mfa) Object.assign(client.auth.mfa, overrides.mfa);
  if (overrides.functions) Object.assign(client.functions, overrides.functions);
  return client;
}

const sampleSession = {
  access_token: "access-token-123",
  user: {
    id: "owner-1",
    email: "owner@example.com",
    app_metadata: { owner_role: "owner" },
  },
};

describe("isValidOwnerSupabaseConfig", () => {
  it("accepts valid https and localhost configs with publishable keys", () => {
    assert.equal(
      isValidOwnerSupabaseConfig(
        "https://tohgadyunmsfcopaldvz.supabase.co",
        "sb_publishable_12345",
      ),
      true,
    );
    assert.equal(
      isValidOwnerSupabaseConfig("http://localhost:54321", "anon-key"),
      true,
    );
  });

  it("rejects empty values, non-localhost http, sb_secret_ keys, and service_role JWTs", () => {
    assert.equal(isValidOwnerSupabaseConfig("", "sb_publishable_123"), false);
    assert.equal(isValidOwnerSupabaseConfig("https://example.com", "   "), false);
    assert.equal(isValidOwnerSupabaseConfig("http://example.com", "sb_publishable_123"), false);
    assert.equal(
      isValidOwnerSupabaseConfig("https://example.com", "sb_secret_should_never_pass"),
      false,
    );
    assert.equal(
      isValidOwnerSupabaseConfig("https://example.com", makeServiceRoleJwt()),
      false,
    );
  });
});

describe("normalizeTotpQrCodeSrc", () => {
  it("normalizes Supabase pre-prefixed utf-8 SVG data URIs without double-wrapping", () => {
    const raw =
      'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg"><path fill="#111"/></svg>';
    const normalized = normalizeTotpQrCodeSrc(raw);
    assert.equal(normalized.startsWith("data:image/svg+xml;charset=utf-8,%3Csvg"), true);
    assert.equal(normalized.includes("#111"), false);
    assert.equal(normalized.includes("data%3Aimage"), false);
  });

  it("encodes raw SVG XML and rejects unsafe URI schemes", () => {
    assert.equal(
      normalizeTotpQrCodeSrc("<svg></svg>"),
      "data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C%2Fsvg%3E",
    );
    assert.equal(normalizeTotpQrCodeSrc("javascript:alert(1)"), "");
    assert.equal(normalizeTotpQrCodeSrc("https://evil.example.com/qr.svg"), "");
  });
});

describe("evaluateOwnerSession", () => {
  it("returns signed-out for null session", async () => {
    const result = await evaluateOwnerSession(makeClient(), null);
    assert.deepEqual(result, { state: "signed-out" });
  });

  it("denies invalid tokens or getUser failures", async () => {
    const client = makeClient({
      auth: {
        async getUser() {
          return { data: { user: null }, error: { message: "invalid jwt" } };
        },
      },
    });
    const result = await evaluateOwnerSession(client, sampleSession);
    assert.equal(result.state, "denied");
    assert.equal(client.invoked.length, 0);
  });

  it("denies authenticated non-owner users without calling owner-authorize", async () => {
    const client = makeClient({
      auth: {
        async getUser() {
          return {
            data: {
              user: {
                id: "staff-1",
                email: "staff@example.com",
                app_metadata: { role: "cashier" },
              },
            },
            error: null,
          };
        },
      },
    });
    const result = await evaluateOwnerSession(client, sampleSession);
    assert.equal(result.state, "denied");
    assert.equal(client.invoked.length, 0);
  });

  it("routes AAL1 owner without verified TOTP to mfa-enroll", async () => {
    const client = makeClient({
      mfa: {
        async getAuthenticatorAssuranceLevel() {
          return { data: { currentLevel: "aal1" }, error: null };
        },
        async listFactors() {
          return {
            data: { totp: [{ id: "unverified-1", status: "unverified" }] },
            error: null,
          };
        },
      },
    });
    const result = await evaluateOwnerSession(client, sampleSession);
    assert.deepEqual(result, { state: "mfa-enroll" });
    assert.equal(client.invoked.length, 0);
  });

  it("routes AAL1 owner with verified TOTP to mfa-challenge", async () => {
    const client = makeClient({
      mfa: {
        async getAuthenticatorAssuranceLevel() {
          return { data: { currentLevel: "aal1" }, error: null };
        },
        async listFactors() {
          return {
            data: { totp: [{ id: "verified-factor-9", status: "verified" }] },
            error: null,
          };
        },
      },
    });
    const result = await evaluateOwnerSession(client, sampleSession);
    assert.deepEqual(result, {
      state: "mfa-challenge",
      factorId: "verified-factor-9",
    });
    assert.equal(client.invoked.length, 0);
  });

  it("fails closed when owner-authorize returns error, false, wrong AAL, or throws", async () => {
    const errorClient = makeClient({
      functions: {
        async invoke() {
          return { data: null, error: { message: "503" } };
        },
      },
    });
    assert.equal((await evaluateOwnerSession(errorClient, sampleSession)).state, "denied");

    const deniedClient = makeClient({
      functions: {
        async invoke() {
          return { data: { authorized: false, assuranceLevel: "aal2" }, error: null };
        },
      },
    });
    assert.equal((await evaluateOwnerSession(deniedClient, sampleSession)).state, "denied");

    const wrongAalClient = makeClient({
      functions: {
        async invoke() {
          return { data: { authorized: true, assuranceLevel: "aal1" }, error: null };
        },
      },
    });
    assert.equal((await evaluateOwnerSession(wrongAalClient, sampleSession)).state, "denied");

    const throwingClient = makeClient({
      functions: {
        async invoke() {
          throw new Error("network down");
        },
      },
    });
    assert.equal((await evaluateOwnerSession(throwingClient, sampleSession)).state, "denied");
  });

  it("grants signed-in only when Owner role, AAL2, and server owner-authorize all succeed", async () => {
    const client = makeClient();
    const result = await evaluateOwnerSession(client, sampleSession);
    assert.equal(result.state, "signed-in");
    assert.equal(client.invoked.length, 1);
    assert.equal(client.invoked[0].name, "owner-authorize");
    assert.equal(
      client.invoked[0].options.headers.Authorization,
      "Bearer access-token-123",
    );
  });
});

describe("enrollOwnerTotp", () => {
  it("cleans up stale unverified TOTP factors without touching verified ones and normalizes QR", async () => {
    const client = makeClient({
      mfa: {
        async listFactors() {
          return {
            data: {
              totp: [],
              all: [
                { id: "stale-totp-1", status: "unverified", factor_type: "totp" },
                { id: "verified-totp-2", status: "verified", factor_type: "totp" },
                { id: "unverified-phone-3", status: "unverified", factor_type: "phone" },
              ],
            },
            error: null,
          };
        },
      },
    });

    const enrolled = await enrollOwnerTotp(client);
    assert.deepEqual(client.unenrolled, ["stale-totp-1"]);
    assert.equal(enrolled.factorId, "totp-new-1");
    assert.equal(enrolled.qrCodeSrc.startsWith("data:image/svg+xml;charset=utf-8,%3Csvg"), true);
    assert.equal(enrolled.secret, "JBSWY3DPEHPK3PXP");
  });
});

describe("signOutOwner", () => {
  it("returns remoteRevoked=true when signOut succeeds", async () => {
    const result = await signOutOwner(makeClient());
    assert.deepEqual(result, { remoteRevoked: true });
  });

  it("falls back to local signOut and never throws when global signOut fails", async () => {
    const scopes = [];
    const client = makeClient({
      auth: {
        async signOut(options) {
          scopes.push(options?.scope ?? "global");
          if (!options?.scope) {
            return { error: new Error("offline") };
          }
          return { error: null };
        },
      },
    });
    const result = await signOutOwner(client);
    assert.deepEqual(result, { remoteRevoked: false });
    assert.deepEqual(scopes, ["global", "local"]);
  });
});
