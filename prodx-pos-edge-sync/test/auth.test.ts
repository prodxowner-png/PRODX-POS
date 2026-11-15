import { beforeEach, describe, expect, it, vi } from "vitest";

const { jwtVerifyMock } = vi.hoisted(() => ({ jwtVerifyMock: vi.fn() }));
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => ({})),
  jwtVerify: jwtVerifyMock,
}));

import { authenticate, authenticateRecoveryOperator, authenticateTenantOperator } from "../src/auth";

const TENANT = "11111111-1111-4111-8111-111111111111";
const TERMINAL = "22222222-2222-4222-8222-222222222222";
const env = {
  ACCESS_TEAM_DOMAIN: "prodx-pos.cloudflareaccess.com",
  ACCESS_AUD: "a".repeat(64),
} as Parameters<typeof authenticate>[1];

function request(): Request {
  return new Request("https://prodx-pos-edge-sync-staging.example.workers.dev/api/v1/pos/sync-batch", {
    method: "POST",
    headers: { "cf-access-jwt-assertion": "signed-access-jwt" },
  });
}

function verifiedPayload(custom: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  jwtVerifyMock.mockResolvedValue({
    payload: { sub: "trusted-subject", custom, ...extra },
  });
}

beforeEach(() => jwtVerifyMock.mockReset());

describe("Cloudflare Access custom OIDC claims", () => {
  it("authenticates terminal scope from the signed custom claim namespace", async () => {
    verifiedPayload({ tenant_id: TENANT, terminal_id: TERMINAL });

    await expect(authenticate(request(), env)).resolves.toEqual({
      tenantId: TENANT,
      terminalId: TERMINAL,
      subject: "trusted-subject",
    });
  });

  it("does not accept tenant scope copied to untrusted top-level claim names", async () => {
    verifiedPayload({}, { tenant_id: TENANT, terminal_id: TERMINAL });

    await expect(authenticate(request(), env)).rejects.toMatchObject({ status: 403 });
  });

  it("authorizes the auditor role only from a signed custom OIDC claim", async () => {
    verifiedPayload({ role: "POS_SYNC_AUDITOR", tenant_id: TENANT });

    await expect(authenticateTenantOperator(request(), env)).resolves.toEqual({
      tenantId: TENANT,
      subject: "trusted-subject",
    });
  });

  it("does not authorize the auditor role from a top-level role claim", async () => {
    verifiedPayload({ tenant_id: TENANT }, { role: "POS_SYNC_AUDITOR" });

    await expect(authenticateTenantOperator(request(), env)).rejects.toMatchObject({ status: 403 });
  });

  it("authorizes recovery only from the exact recovery-admin custom claim", async () => {
    verifiedPayload({ role: "POS_SYNC_RECOVERY_ADMIN", tenant_id: TENANT });

    await expect(authenticateRecoveryOperator(request(), env)).resolves.toEqual({
      tenantId: TENANT,
      subject: "trusted-subject",
    });
  });

  it("does not allow an auditor claim to authorize recovery", async () => {
    verifiedPayload({ role: "POS_SYNC_AUDITOR", tenant_id: TENANT });

    await expect(authenticateRecoveryOperator(request(), env)).rejects.toMatchObject({ status: 403 });
  });
});
