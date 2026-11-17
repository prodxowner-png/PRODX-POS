import type {
  OfflineSale,
  CanonicalSalePayload,
  DeviceSignatureEnvelope,
  DeviceSignature
} from "./contracts";

export const PAYLOAD_DOMAIN = "prodx-pos-device-sale-payload/v1";
export const SIGNATURE_DOMAIN = "prodx-pos-device-sale-signature/v1";
export const PROTOCOL_VERSION = "prodx-pos-device-sale/v1";

// P-256 group order n and half-order for strict low-S validation
export const P256_ORDER = BigInt("0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551");
export const P256_HALF_ORDER = P256_ORDER / 2n;

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

/**
 * Builds the canonical domain-separated payload structure specified in CF-01 protocol v1.
 * Excludes only the transport fields `payload_hash` and `device_signature`.
 */
export function buildCanonicalSalePayload(
  tenantId: string,
  terminalId: string,
  sale: OfflineSale
): CanonicalSalePayload {
  const {
    payload_hash: _ignoredHash,
    device_signature: _ignoredSig,
    ...hashableSale
  } = sale;

  return {
    domain: PAYLOAD_DOMAIN,
    protocol: PROTOCOL_VERSION,
    sale: hashableSale as Record<string, unknown>,
    tenant_id: tenantId,
    terminal_id: terminalId
  };
}

/**
 * Computes the canonical tenant-bound payload hash (RFC 8785 + SHA-256).
 * Shared identically across Edge ingress and backend origin verifiers.
 */
export async function computeCanonicalPayloadHash(
  tenantId: string,
  terminalId: string,
  sale: OfflineSale
): Promise<string> {
  const canonicalPayload = buildCanonicalSalePayload(tenantId, terminalId, sale);
  const jcs = canonicalize(canonicalPayload);
  return await sha256Hex(jcs);
}

/**
 * Builds the canonical signature envelope as specified in CF-01 protocol v1.
 */
export function buildDeviceSignatureEnvelope(params: {
  key_id: string;
  tenant_id: string;
  terminal_id: string;
  sale_id: string;
  terminal_seq_no: number;
  payload_hash: string;
  issued_at: string;
  nonce: string;
}): DeviceSignatureEnvelope {
  return {
    domain: SIGNATURE_DOMAIN,
    issued_at: params.issued_at,
    key_id: params.key_id,
    nonce: params.nonce,
    payload_hash: params.payload_hash,
    protocol: PROTOCOL_VERSION,
    sale_id: params.sale_id,
    tenant_id: params.tenant_id,
    terminal_id: params.terminal_id,
    terminal_seq_no: params.terminal_seq_no
  };
}

export async function computeEnvelopeHash(envelope: DeviceSignatureEnvelope): Promise<string> {
  const jcs = canonicalize(envelope);
  return await sha256Hex(jcs);
}

export function base64UrlToBytes(base64url: string): Uint8Array {
  if (base64url.includes("=") || !/^[A-Za-z0-9_-]+$/.test(base64url)) {
    throw new Error("INVALID_BASE64URL_ENCODING");
  }
  let base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) base64 += "=";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Decodes a 64-byte IEEE-P1363 signature `r || s` from unpadded base64url.
 * Enforces byte-for-byte roundtrip canonicality, range, and evaluates low-S.
 */
export function decodeP1363Signature(sigB64Url: string): {
  r: bigint;
  s: bigint;
  rawBytes: Uint8Array;
  isLowS: boolean;
} {
  const bytes = base64UrlToBytes(sigB64Url);
  if (bytes.length !== 64) {
    throw new Error("INVALID_SIGNATURE_LENGTH_MUST_BE_64_BYTES");
  }

  // Canonical roundtrip check: reject non-zero unused trailing bits or alternate alphabets
  if (bytesToBase64Url(bytes) !== sigB64Url) {
    throw new Error("NON_CANONICAL_BASE64URL_SIGNATURE");
  }

  let rHex = "";
  for (let i = 0; i < 32; i++) rHex += bytes[i]!.toString(16).padStart(2, "0");
  let sHex = "";
  for (let i = 32; i < 64; i++) sHex += bytes[i]!.toString(16).padStart(2, "0");

  const r = BigInt("0x" + rHex);
  const s = BigInt("0x" + sHex);

  if (r <= 0n || r >= P256_ORDER) throw new Error("SIGNATURE_R_OUT_OF_RANGE");
  if (s <= 0n || s >= P256_ORDER) throw new Error("SIGNATURE_S_OUT_OF_RANGE");

  const isLowS = s <= P256_HALF_ORDER;
  return { r, s, rawBytes: bytes, isLowS };
}

/**
 * Verifies ECDSA P-256 signature with SHA-256 over the canonical envelope JCS bytes.
 * Mandates the low-S canonicality profile: high-S signatures are strictly rejected.
 */
export async function verifyDeviceSignature(
  envelope: DeviceSignatureEnvelope,
  signatureB64Url: string,
  publicKey: CryptoKey | JsonWebKey
): Promise<{ valid: boolean; reason?: string }> {
  let decoded: ReturnType<typeof decodeP1363Signature>;
  try {
    decoded = decodeP1363Signature(signatureB64Url);
  } catch (err) {
    return { valid: false, reason: err instanceof Error ? err.message : "SIGNATURE_DECODE_FAILED" };
  }

  // Mandate low-S canonicality
  if (!decoded.isLowS) {
    return { valid: false, reason: "HIGH_S_SIGNATURE_REJECTED" };
  }

  const envelopeJcs = canonicalize(envelope);
  const canonicalBytes = new TextEncoder().encode(envelopeJcs);

  let key: CryptoKey;
  if ("algorithm" in (publicKey as object)) {
    key = publicKey as CryptoKey;
  } else {
    key = await crypto.subtle.importKey(
      "jwk",
      publicKey as JsonWebKey,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );
  }

  const verified = await crypto.subtle.verify(
    { name: "ECDSA", hash: { name: "SHA-256" } },
    key,
    decoded.rawBytes as unknown as BufferSource,
    canonicalBytes as unknown as BufferSource
  );

  return verified ? { valid: true } : { valid: false, reason: "CRYPTOGRAPHIC_SIGNATURE_INVALID" };
}

/**
 * Strict JSON lexer / parser check ensuring no duplicate object keys exist before materialization.
 */
export function assertNoDuplicateJsonKeys(jsonText: string): void {
  let pos = 0;
  const len = jsonText.length;

  function skipWhitespace() {
    while (pos < len && (jsonText[pos] === " " || jsonText[pos] === "\t" || jsonText[pos] === "\n" || jsonText[pos] === "\r")) {
      pos++;
    }
  }

  function parseString(): string {
    pos++; // skip initial '"'
    let str = "";
    while (pos < len) {
      const ch = jsonText[pos]!;
      if (ch === '"') {
        pos++;
        return str;
      }
      if (ch === "\\") {
        pos++;
        if (pos >= len) throw new Error("UNTERMINATED_JSON_ESCAPE");
        const esc = jsonText[pos]!;
        if (esc === '"' || esc === "\\" || esc === "/") { str += esc; pos++; }
        else if (esc === "b") { str += "\b"; pos++; }
        else if (esc === "f") { str += "\f"; pos++; }
        else if (esc === "n") { str += "\n"; pos++; }
        else if (esc === "r") { str += "\r"; pos++; }
        else if (esc === "t") { str += "\t"; pos++; }
        else if (esc === "u") {
          pos++;
          const hex = jsonText.slice(pos, pos + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Error("INVALID_UNICODE_ESCAPE");
          str += String.fromCharCode(parseInt(hex, 16));
          pos += 4;
        } else {
          throw new Error("INVALID_JSON_ESCAPE");
        }
      } else {
        str += ch;
        pos++;
      }
    }
    throw new Error("UNTERMINATED_JSON_STRING");
  }

  function parseValue() {
    skipWhitespace();
    if (pos >= len) return;
    const ch = jsonText[pos]!;
    if (ch === "{") {
      pos++;
      const currentKeys = new Set<string>();
      skipWhitespace();
      if (pos < len && jsonText[pos] === "}") {
        pos++;
        return;
      }
      while (pos < len) {
        skipWhitespace();
        if (jsonText[pos] !== '"') throw new Error("EXPECTED_JSON_STRING_KEY");
        const key = parseString();
        if (currentKeys.has(key)) {
          throw new Error(`DUPLICATE_JSON_KEY_REJECTED:${key}`);
        }
        currentKeys.add(key);
        skipWhitespace();
        if (jsonText[pos] !== ":") throw new Error("EXPECTED_COLON_AFTER_KEY");
        pos++;
        parseValue();
        skipWhitespace();
        if (jsonText[pos] === "}") {
          pos++;
          return;
        }
        if (jsonText[pos] !== ",") throw new Error("EXPECTED_COMMA_IN_OBJECT");
        pos++;
      }
    } else if (ch === "[") {
      pos++;
      skipWhitespace();
      if (pos < len && jsonText[pos] === "]") { pos++; return; }
      while (pos < len) {
        parseValue();
        skipWhitespace();
        if (jsonText[pos] === "]") { pos++; return; }
        if (jsonText[pos] !== ",") throw new Error("EXPECTED_COMMA_IN_ARRAY");
        pos++;
      }
    } else if (ch === '"') {
      parseString();
    } else {
      while (pos < len && !" \t\r\n,]}".includes(jsonText[pos]!)) {
        pos++;
      }
    }
  }

  parseValue();
  skipWhitespace();
  if (pos !== len) throw new Error("TRAILING_JSON_CHARACTERS");
}

export function assertSaleShape(sale: unknown): asserts sale is OfflineSale {
  if (!sale || typeof sale !== "object") throw new Error("INVALID_SALE");
  const s = sale as Record<string, unknown>;
  if (typeof s.idempotency_key !== "string" || s.idempotency_key.length < 16 || s.idempotency_key.length > 200) {
    throw new Error("INVALID_IDEMPOTENCY_KEY");
  }
  if (typeof s.payload_hash !== "string" || !/^[a-f0-9]{64}$/i.test(s.payload_hash)) {
    throw new Error("INVALID_PAYLOAD_HASH");
  }
  if (typeof s.sale_id !== "string" || !isUuid(s.sale_id)) throw new Error("INVALID_SALE_ID");
  if (!Number.isSafeInteger(s.terminal_seq_no) || (s.terminal_seq_no as number) < 1) {
    throw new Error("INVALID_TERMINAL_SEQUENCE");
  }
  if (!Number.isSafeInteger(s.catalog_version) || (s.catalog_version as number) < 1) {
    throw new Error("INVALID_CATALOG_VERSION");
  }
  if (typeof s.client_recorded_at !== "string" || Number.isNaN(Date.parse(s.client_recorded_at))) {
    throw new Error("INVALID_CLIENT_TIMESTAMP");
  }
  if (
    !s.hlc ||
    typeof s.hlc !== "object" ||
    !Number.isSafeInteger((s.hlc as Record<string, unknown>).physical_ms) ||
    !Number.isSafeInteger((s.hlc as Record<string, unknown>).logical) ||
    (s.hlc as Record<string, number>).physical_ms < 0 ||
    (s.hlc as Record<string, number>).logical < 0 ||
    (s.hlc as Record<string, number>).logical > 2147483647
  ) {
    throw new Error("INVALID_HLC");
  }
  if (!Array.isArray(s.signed_price_proofs) || s.signed_price_proofs.length < 1 || s.signed_price_proofs.length > 200) {
    throw new Error("INVALID_SIGNED_PRICE_PROOFS");
  }
  if (s.currency !== "THB") throw new Error("UNSUPPORTED_CURRENCY");
  if (!Array.isArray(s.lines) || s.lines.length < 1 || s.lines.length > 200) throw new Error("INVALID_LINES");
  for (const line of s.lines as Array<Record<string, unknown>>) {
    if (typeof line.product_id !== "string" || !isUuid(line.product_id)) throw new Error("INVALID_PRODUCT_ID");
    if (
      !Number.isSafeInteger(line.quantity) ||
      (line.quantity as number) <= 0 ||
      (line.quantity as number) > 2147483647
    ) {
      throw new Error("INVALID_QUANTITY");
    }
    if (!Number.isSafeInteger(line.unit_price_minor) || (line.unit_price_minor as number) < 0) {
      throw new Error("INVALID_UNIT_PRICE");
    }
    if (!Number.isSafeInteger(line.tax_bps) || (line.tax_bps as number) < 0 || (line.tax_bps as number) > 10000) {
      throw new Error("INVALID_TAX_RATE");
    }
  }

  if (s.device_signature) {
    const ds = s.device_signature as Record<string, unknown>;
    if (ds.algorithm !== "ECDSA-P256-SHA256") throw new Error("UNSUPPORTED_SIGNATURE_ALGORITHM");
    if (typeof ds.key_id !== "string" || !ds.key_id.trim()) throw new Error("INVALID_KEY_ID");
    if (typeof ds.signature !== "string" || !ds.signature.trim()) throw new Error("INVALID_SIGNATURE");
    if (typeof ds.issued_at !== "string" || Number.isNaN(Date.parse(ds.issued_at))) throw new Error("INVALID_SIGNATURE_ISSUED_AT");
    if (typeof ds.nonce !== "string" || !ds.nonce.trim()) throw new Error("INVALID_SIGNATURE_NONCE");
  }
}
