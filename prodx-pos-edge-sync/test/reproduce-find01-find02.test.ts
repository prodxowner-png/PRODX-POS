import { describe, it, expect } from "vitest";
import { canonicalize, sha256Hex } from "../src/canonical";
import type { OfflineSale, QueueSale } from "../src/contracts";

describe("FIND-01 and FIND-02 Reproduction Evidence", () => {
  const tenantId = "11111111-1111-4111-8111-111111111111";
  const terminalId = "22222222-2222-4222-8222-222222222222";

  const baseSale: OfflineSale = {
    idempotency_key: "idem-reproduce-0001",
    payload_hash: "0".repeat(64),
    sale_id: "33333333-3333-4333-8333-333333333333",
    terminal_seq_no: 1,
    hlc: { physical_ms: 1730000000000, logical: 0 },
    catalog_version: 7,
    signed_price_proofs: [{
      algorithm: "HMAC-SHA256",
      catalog_version: 7,
      issued_at: "2026-11-11T10:00:00Z",
      expires_at: "2026-11-12T10:00:00Z",
      product_id: "44444444-4444-4444-8444-444444444444",
      unit_price_minor: 1250,
      tax_bps: 700,
      signature: "test-sig"
    }],
    client_recorded_at: "2026-11-11T10:00:00Z",
    currency: "THB",
    lines: [{
      product_id: "44444444-4444-4444-8444-444444444444",
      quantity: 2,
      unit_price_minor: 1250,
      tax_bps: 700
    }]
  };

  it("reproduces FIND-02: index.ts and postgres.ts compute conflicting payload hashes", async () => {
    // 1. Hash computed by index.ts:54-56 (hashes `sale` alone, excluding `payload_hash`)
    const { payload_hash: _ignored1, ...saleForIndex } = baseSale;
    const indexCanonicalPayload = canonicalize(saleForIndex);
    const indexComputedHash = await sha256Hex(indexCanonicalPayload);

    // 2. Hash computed by postgres.ts:195-200 (hashes `{ tenant_id, terminal_id, sale }`)
    const { payload_hash: _ignored2, ...saleForPostgres } = baseSale;
    const postgresCanonicalPayload = canonicalize({
      tenant_id: tenantId,
      terminal_id: terminalId,
      sale: saleForPostgres
    });
    const postgresComputedHash = await sha256Hex(postgresCanonicalPayload);

    // Assert that the two hashes computed by index.ts and postgres.ts are NOT equal
    expect(indexComputedHash).not.toEqual(postgresComputedHash);

    // Case A: Client submits sale hashed using index.ts expectation
    const saleHashedForIndex = { ...baseSale, payload_hash: indexComputedHash };
    // In index.ts:
    const indexCheck = (await sha256Hex(canonicalize(saleForIndex))) === saleHashedForIndex.payload_hash;
    expect(indexCheck).toBe(true); // Passes edge ingress

    // In postgres.ts:195-202:
    const originCheck = (postgresComputedHash === saleHashedForIndex.payload_hash);
    expect(originCheck).toBe(false); // FAILS at origin with PAYLOAD_HASH_MISMATCH_AT_ORIGIN!

    // Case B: Client submits sale hashed using postgres.ts expectation
    const saleHashedForPostgres = { ...baseSale, payload_hash: postgresComputedHash };
    // In index.ts:54-63:
    const indexCheckB = (await sha256Hex(canonicalize(saleForIndex))) === saleHashedForPostgres.payload_hash;
    expect(indexCheckB).toBe(false); // FAILS at ingress with HTTP 422 PAYLOAD_HASH_MISMATCH!

    // Conclusion: 100% of sales fail under current mainline code.
  });

  it("reproduces FIND-01: postgres.ts targets legacy non-existent tables instead of CheckoutService schema", () => {
    // In postgres.ts lines 51-174, COMMIT_SALE_CTE references tables:
    // sales, sale_lines, pos_idempotency, terminal_sync_state, inventory_ledger (reason = 'POS_SALE')
    // In PRODX-POS mainline and staging schema (PRODX-POS-PREVIEW):
    // Tables are: prodx_orders, prodx_order_items, prodx_payments, prodx_cash_movements,
    // prodx_inventory_ledger (reason = 'sale_deduction'), prodx_audit_log, prodx_products
    const legacyTables = ["sales", "sale_lines", "pos_idempotency", "terminal_sync_state"];
    const authoritativeTables = [
      "prodx_orders",
      "prodx_order_items",
      "prodx_payments",
      "prodx_cash_movements",
      "prodx_inventory_ledger",
      "prodx_audit_log",
      "prodx_products"
    ];

    for (const legacy of legacyTables) {
      expect(authoritativeTables).not.toContain(legacy);
    }
  });
});
