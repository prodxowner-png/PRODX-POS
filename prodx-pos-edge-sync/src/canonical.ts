export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(",")}}`;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function assertSaleShape(sale: unknown): asserts sale is import("./contracts").OfflineSale {
  if (!sale || typeof sale !== "object") throw new Error("INVALID_SALE");
  const s = sale as Record<string, unknown>;
  if (typeof s.idempotency_key !== "string" || s.idempotency_key.length < 16 || s.idempotency_key.length > 200) throw new Error("INVALID_IDEMPOTENCY_KEY");
  if (typeof s.payload_hash !== "string" || !/^[a-f0-9]{64}$/i.test(s.payload_hash)) throw new Error("INVALID_PAYLOAD_HASH");
  if (typeof s.sale_id !== "string" || !isUuid(s.sale_id)) throw new Error("INVALID_SALE_ID");
  if (!Number.isSafeInteger(s.terminal_seq_no) || (s.terminal_seq_no as number) < 1) throw new Error("INVALID_TERMINAL_SEQUENCE");
  if (!Number.isSafeInteger(s.catalog_version) || (s.catalog_version as number) < 1) throw new Error("INVALID_CATALOG_VERSION");
  if (typeof s.client_recorded_at !== "string" || Number.isNaN(Date.parse(s.client_recorded_at))) throw new Error("INVALID_CLIENT_TIMESTAMP");
  if (!s.hlc || typeof s.hlc !== "object" ||
      !Number.isSafeInteger((s.hlc as Record<string, unknown>).physical_ms) ||
      !Number.isSafeInteger((s.hlc as Record<string, unknown>).logical) ||
      ((s.hlc as Record<string, number>).physical_ms < 0) ||
      ((s.hlc as Record<string, number>).logical < 0) ||
      ((s.hlc as Record<string, number>).logical > 2147483647)) throw new Error("INVALID_HLC");
  if (!Array.isArray(s.signed_price_proofs) || s.signed_price_proofs.length < 1 || s.signed_price_proofs.length > 200) {
    throw new Error("INVALID_SIGNED_PRICE_PROOFS");
  }
  if (s.currency !== "THB") throw new Error("UNSUPPORTED_CURRENCY");
  if (!Array.isArray(s.lines) || s.lines.length < 1 || s.lines.length > 200) throw new Error("INVALID_LINES");
  for (const line of s.lines as Array<Record<string, unknown>>) {
    if (typeof line.product_id !== "string" || !isUuid(line.product_id)) throw new Error("INVALID_PRODUCT_ID");
    if (!Number.isSafeInteger(line.quantity) || (line.quantity as number) <= 0 ||
        (line.quantity as number) > 2147483647) throw new Error("INVALID_QUANTITY");
    if (!Number.isSafeInteger(line.unit_price_minor) || (line.unit_price_minor as number) < 0) throw new Error("INVALID_UNIT_PRICE");
    if (!Number.isSafeInteger(line.tax_bps) || (line.tax_bps as number) < 0 || (line.tax_bps as number) > 10000) throw new Error("INVALID_TAX_RATE");
  }
}
