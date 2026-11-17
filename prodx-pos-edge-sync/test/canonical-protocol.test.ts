import { describe, it, expect } from "vitest";
import {
  canonicalize,
  sha256Hex,
  buildCanonicalSalePayload,
  computeCanonicalPayloadHash,
  buildDeviceSignatureEnvelope,
  computeEnvelopeHash,
  decodeP1363Signature,
  verifyDeviceSignature,
  assertNoDuplicateJsonKeys,
  P256_ORDER,
  P256_HALF_ORDER,
  PAYLOAD_DOMAIN,
  SIGNATURE_DOMAIN,
  PROTOCOL_VERSION
} from "../src/canonical";
import type { OfflineSale, DeviceSignatureEnvelope } from "../src/contracts";

// Well-known test-only public key from docs/cf01-device-signature-test-vectors-v1.md
const TEST_PUBLIC_JWK: JsonWebKey = {
  kty: "EC",
  crv: "P-256",
  x: "axfR8uEsQkf4vOblY6RA8ncDfYEt6zOg9KE5RdiYwpY",
  y: "T-NC4v4af5uO5-tKfA-eFivOM1drMV7Oy7ZAaDe_UfU",
  ext: true
};

const POSITIVE_LOW_S_SIG = "rX3QpYTa3eqzDf9TiDl6dsqnmGs8EZ7mhoEqGwkVEesmTHkG18Z5ZQU7E8a0FD9s3qEBx8j4-LGluBqIsKMssA";
const NEGATIVE_HIGH_S_SIG = "jvdQLc1de2oZHE9OVuYgoxgMNxVEkIVSx4I0-xMg3r2bqR6snpvWGxcG1OSxTZ7Nnmrn03ggHFB3t4gnTYHa9w";

describe("CF-01 Protocol v1 Test Vectors and Signature Canonicalization", () => {
  const tenantId = "11111111-1111-4111-8111-111111111111";
  const terminalId = "22222222-2222-4222-8222-222222222222";

  const fixtureSale: OfflineSale = {
    idempotency_key: "idem-0001",
    payload_hash: "6ddbb17cf4d8f579ed49ad4751fe61772bf07019a19094fce459961b8d726454",
    sale_id: "33333333-3333-4333-8333-333333333333",
    terminal_seq_no: 1,
    hlc: { logical: 0, physical_ms: 1730000000000 },
    catalog_version: 7,
    signed_price_proofs: [],
    client_recorded_at: "2026-11-11T10:00:00Z",
    currency: "THB",
    lines: [{
      product_id: "44444444-4444-4444-8444-444444444444",
      quantity: 2,
      unit_price_minor: 1250
    } as any]
  };

  it("Section 2: matches exact canonical payload JCS bytes and SHA-256 test vector", async () => {
    // Exact input from Section 2 of cf01-device-signature-test-vectors-v1.md
    const payloadObject = buildCanonicalSalePayload(tenantId, terminalId, fixtureSale);
    const jcs = canonicalize(payloadObject);
    const expectedJcs = '{"domain":"prodx-pos-device-sale-payload/v1","protocol":"prodx-pos-device-sale/v1","sale":{"catalog_version":7,"client_recorded_at":"2026-11-11T10:00:00Z","currency":"THB","hlc":{"logical":0,"physical_ms":1730000000000},"idempotency_key":"idem-0001","lines":[{"product_id":"44444444-4444-4444-8444-444444444444","quantity":2,"unit_price_minor":1250}],"sale_id":"33333333-3333-4333-8333-333333333333","signed_price_proofs":[],"terminal_seq_no":1},"tenant_id":"11111111-1111-4111-8111-111111111111","terminal_id":"22222222-2222-4222-8222-222222222222"}';

    // Verify JCS serialization stability
    expect(jcs).toBe(expectedJcs);

    // Verify exact expected SHA-256
    const hash = await sha256Hex(jcs);
    const expectedHash = "6ddbb17cf4d8f579ed49ad4751fe61772bf07019a19094fce459961b8d726454";
    expect(hash).toBe(expectedHash);

    // Verify helper function gives identical output
    const computed = await computeCanonicalPayloadHash(tenantId, terminalId, fixtureSale);
    expect(computed).toBe(hash);
  });

  it("Section 2: tenant-binding negative vector changes payload hash", async () => {
    const alteredTenant = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const baseHash = await computeCanonicalPayloadHash(tenantId, terminalId, fixtureSale);
    const alteredHash = await computeCanonicalPayloadHash(alteredTenant, terminalId, fixtureSale);

    expect(alteredHash).not.toBe(baseHash);
  });

  it("Section 2: terminal-binding negative vector changes payload hash", async () => {
    const alteredTerminal = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const baseHash = await computeCanonicalPayloadHash(tenantId, terminalId, fixtureSale);
    const alteredHash = await computeCanonicalPayloadHash(tenantId, alteredTerminal, fixtureSale);

    expect(alteredHash).not.toBe(baseHash);
  });

  it("Section 3: matches exact canonical signature envelope JCS bytes and SHA-256", async () => {
    const envelope: DeviceSignatureEnvelope = {
      domain: "prodx-pos-device-sale-signature/v1",
      protocol: "prodx-pos-device-sale/v1",
      key_id: "key-stg-0001",
      tenant_id: "11111111-1111-4111-8111-111111111111",
      terminal_id: "22222222-2222-4222-8222-222222222222",
      sale_id: "33333333-3333-4333-8333-333333333333",
      terminal_seq_no: 1,
      payload_hash: "6ddbb17cf4d8f579ed49ad4751fe61772bf07019a19094fce459961b8d726454",
      issued_at: "2026-11-11T10:00:01Z",
      nonce: "AAECAwQFBgcICQoLDA0ODw"
    };

    const jcs = canonicalize(envelope);
    const expectedJcs = '{"domain":"prodx-pos-device-sale-signature/v1","issued_at":"2026-11-11T10:00:01Z","key_id":"key-stg-0001","nonce":"AAECAwQFBgcICQoLDA0ODw","payload_hash":"6ddbb17cf4d8f579ed49ad4751fe61772bf07019a19094fce459961b8d726454","protocol":"prodx-pos-device-sale/v1","sale_id":"33333333-3333-4333-8333-333333333333","tenant_id":"11111111-1111-4111-8111-111111111111","terminal_id":"22222222-2222-4222-8222-222222222222","terminal_seq_no":1}';

    expect(jcs).toBe(expectedJcs);
    const hash = await computeEnvelopeHash(envelope);
    expect(hash).toBe("ba4b783c9718d96e733631d45511003e2ef5143f56b42d2a3bab329654867f2b");
  });

  it("Section 4: accepts canonical low-S positive signature vector", async () => {
    const envelope: DeviceSignatureEnvelope = {
      domain: "prodx-pos-device-sale-signature/v1",
      protocol: "prodx-pos-device-sale/v1",
      key_id: "key-stg-0001",
      tenant_id: "11111111-1111-4111-8111-111111111111",
      terminal_id: "22222222-2222-4222-8222-222222222222",
      sale_id: "33333333-3333-4333-8333-333333333333",
      terminal_seq_no: 1,
      payload_hash: "6ddbb17cf4d8f579ed49ad4751fe61772bf07019a19094fce459961b8d726454",
      issued_at: "2026-11-11T10:00:01Z",
      nonce: "AAECAwQFBgcICQoLDA0ODw"
    };

    const decoded = decodeP1363Signature(POSITIVE_LOW_S_SIG);
    expect(decoded.rawBytes.length).toBe(64);
    expect(decoded.isLowS).toBe(true);
    expect(decoded.s <= P256_HALF_ORDER).toBe(true);

    const result = await verifyDeviceSignature(envelope, POSITIVE_LOW_S_SIG, TEST_PUBLIC_JWK);
    expect(result.valid).toBe(true);
  });

  it("Section 4: strictly rejects mathematically valid high-S signature vector", async () => {
    const envelope: DeviceSignatureEnvelope = {
      domain: "prodx-pos-device-sale-signature/v1",
      protocol: "prodx-pos-device-sale/v1",
      key_id: "key-stg-0001",
      tenant_id: "11111111-1111-4111-8111-111111111111",
      terminal_id: "22222222-2222-4222-8222-222222222222",
      sale_id: "33333333-3333-4333-8333-333333333333",
      terminal_seq_no: 1,
      payload_hash: "6ddbb17cf4d8f579ed49ad4751fe61772bf07019a19094fce459961b8d726454",
      issued_at: "2026-11-11T10:00:01Z",
      nonce: "AAECAwQFBgcICQoLDA0ODw"
    };

    const decoded = decodeP1363Signature(NEGATIVE_HIGH_S_SIG);
    expect(decoded.rawBytes.length).toBe(64);
    expect(decoded.isLowS).toBe(false);
    expect(decoded.s > P256_HALF_ORDER).toBe(true);

    const result = await verifyDeviceSignature(envelope, NEGATIVE_HIGH_S_SIG, TEST_PUBLIC_JWK);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("HIGH_S_SIGNATURE_REJECTED");
  });

  it("Hardening: rejects non-canonical and malformed signatures", async () => {
    const envelope: DeviceSignatureEnvelope = {
      domain: "prodx-pos-device-sale-signature/v1",
      protocol: "prodx-pos-device-sale/v1",
      key_id: "key-stg-0001",
      tenant_id: "11111111-1111-4111-8111-111111111111",
      terminal_id: "22222222-2222-4222-8222-222222222222",
      sale_id: "33333333-3333-4333-8333-333333333333",
      terminal_seq_no: 1,
      payload_hash: "6ddbb17cf4d8f579ed49ad4751fe61772bf07019a19094fce459961b8d726454",
      issued_at: "2026-11-11T10:00:01Z",
      nonce: "AAECAwQFBgcICQoLDA0ODw"
    };

    // Padded base64url
    const padded = POSITIVE_LOW_S_SIG + "==";
    expect((await verifyDeviceSignature(envelope, padded, TEST_PUBLIC_JWK)).valid).toBe(false);

    // Truncated signature (less than 64 bytes)
    const truncated = POSITIVE_LOW_S_SIG.slice(0, 30);
    expect((await verifyDeviceSignature(envelope, truncated, TEST_PUBLIC_JWK)).valid).toBe(false);

    // Tampered envelope field
    const tamperedEnvelope = { ...envelope, terminal_seq_no: 2 };
    const tamperedResult = await verifyDeviceSignature(tamperedEnvelope, POSITIVE_LOW_S_SIG, TEST_PUBLIC_JWK);
    expect(tamperedResult.valid).toBe(false);
    expect(tamperedResult.reason).toBe("CRYPTOGRAPHIC_SIGNATURE_INVALID");
  });

  it("Hardening: assertNoDuplicateJsonKeys rejects duplicate object keys", () => {
    // Valid JSON with nested objects
    expect(() => assertNoDuplicateJsonKeys('{"valid": 1, "nested": {"key": 2}}')).not.toThrow();

    // Literal duplicate key
    expect(() => assertNoDuplicateJsonKeys('{"dup": 1, "dup": 2}')).toThrow(/DUPLICATE_JSON_KEY_REJECTED:dup/);

    // Escaped duplicate key (\u0061 vs a)
    expect(() => assertNoDuplicateJsonKeys('{"a": 1, "\\u0061": 2}')).toThrow(/DUPLICATE_JSON_KEY_REJECTED:a/);
  });
});
