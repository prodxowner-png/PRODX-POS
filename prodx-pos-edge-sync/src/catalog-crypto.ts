import { canonicalize, isUuid } from "./canonical";
import type { SignedCatalogItem, SignedCatalogSnapshot, SignedPriceProof } from "./contracts";

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}
function toBase64Url(value: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(value)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  if (secret.length < 32) throw new Error("CATALOG_SIGNING_KEY_MUST_BE_AT_LEAST_32_CHARACTERS");
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function unsignedSnapshot(snapshot: Omit<SignedCatalogSnapshot, "signature">): string {
  return canonicalize({
    algorithm: snapshot.algorithm,
    catalog_version: snapshot.catalog_version,
    expires_at: snapshot.expires_at,
    issued_at: snapshot.issued_at,
    items: [...snapshot.items].sort((a, b) => a.product_id.localeCompare(b.product_id))
  });
}

export async function signCatalogSnapshot(
  catalogVersion: number, items: SignedCatalogItem[], secret: string, ttlSeconds = 86400
): Promise<SignedCatalogSnapshot> {
  if (!Number.isSafeInteger(catalogVersion) || catalogVersion < 1 ||
      !Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 7 * 86400 ||
      items.some((item) => !isUuid(item.product_id) || !item.sku || !item.name ||
        !Number.isSafeInteger(item.product_version) || item.product_version < 1 ||
        !Number.isSafeInteger(item.unit_price_minor) || item.unit_price_minor < 0 ||
        !Number.isSafeInteger(item.tax_bps) || item.tax_bps < 0 || item.tax_bps > 10000)) {
    throw new Error("INVALID_CATALOG_SNAPSHOT_INPUT");
  }
  const issuedAt = new Date();
  const unsigned = {
    algorithm: "HMAC-SHA256" as const,
    catalog_version: catalogVersion,
    issued_at: issuedAt.toISOString(),
    expires_at: new Date(issuedAt.getTime() + ttlSeconds * 1000).toISOString(),
    items: [...items].sort((a, b) => a.product_id.localeCompare(b.product_id))
  };
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(unsignedSnapshot(unsigned)));
  return { ...unsigned, signature: toBase64Url(signature) };
}

export async function verifyCatalogSnapshot(
  snapshot: SignedCatalogSnapshot, secret: string, now = Date.now()
): Promise<boolean> {
  if (!snapshot || snapshot.algorithm !== "HMAC-SHA256" ||
      !Number.isSafeInteger(snapshot.catalog_version) || snapshot.catalog_version < 1 ||
      !Array.isArray(snapshot.items) ||
      snapshot.items.some((item) => !isUuid(item.product_id) || !item.sku || !item.name ||
        !Number.isSafeInteger(item.product_version) || item.product_version < 1 ||
        !Number.isSafeInteger(item.unit_price_minor) || item.unit_price_minor < 0 ||
        !Number.isSafeInteger(item.tax_bps) || item.tax_bps < 0 || item.tax_bps > 10000) ||
      !Number.isFinite(Date.parse(snapshot.issued_at)) || !Number.isFinite(Date.parse(snapshot.expires_at))) return false;
  const issued = Date.parse(snapshot.issued_at);
  const expires = Date.parse(snapshot.expires_at);
  if (!Number.isFinite(now) || issued > now + 60_000 || expires <= now || expires <= issued || expires - issued > 7 * 86400_000) return false;
  try {
    const key = await hmacKey(secret);
    return await crypto.subtle.verify("HMAC", key, fromBase64Url(snapshot.signature),
      new TextEncoder().encode(unsignedSnapshot(snapshot)));
  } catch { return false; }
}

function unsignedPriceProof(proof: Omit<SignedPriceProof, "signature">): string {
  return canonicalize({
    algorithm: proof.algorithm,
    catalog_version: proof.catalog_version,
    expires_at: proof.expires_at,
    issued_at: proof.issued_at,
    product_id: proof.product_id,
    tax_bps: proof.tax_bps,
    unit_price_minor: proof.unit_price_minor
  });
}

export async function signCatalogPriceProofs(
  catalogVersion: number, items: Array<Pick<SignedCatalogItem,"product_id"|"unit_price_minor"|"tax_bps">>, secret: string, ttlSeconds = 86400
): Promise<SignedPriceProof[]> {
  if (!Number.isSafeInteger(catalogVersion) || catalogVersion < 1 ||
      !Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 7 * 86400 ||
      items.some((item) => !isUuid(item.product_id) || !Number.isSafeInteger(item.unit_price_minor) || item.unit_price_minor < 0 ||
        !Number.isSafeInteger(item.tax_bps) || item.tax_bps < 0 || item.tax_bps > 10000)) {
    throw new Error("INVALID_CATALOG_PRICE_PROOFS_INPUT");
  }
  const issued = new Date();
  const issuedAt = issued.toISOString();
  const expiresAt = new Date(issued.getTime() + ttlSeconds * 1000).toISOString();
  const key = await hmacKey(secret);
  const proofs: SignedPriceProof[] = [];
  for (const item of items) {
    const unsigned = {
      algorithm: "HMAC-SHA256" as const,
      catalog_version: catalogVersion,
      issued_at: issuedAt,
      expires_at: expiresAt,
      product_id: item.product_id,
      unit_price_minor: item.unit_price_minor,
      tax_bps: item.tax_bps
    };
    const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(unsignedPriceProof(unsigned)));
    proofs.push({ ...unsigned, signature: toBase64Url(signature) });
  }
  return proofs;
}

export async function verifySalePrices(
  sale: import("./contracts").OfflineSale, secret: string, verifiedAt = Date.now()
): Promise<boolean> {
  if (!Number.isSafeInteger(sale.catalog_version) || sale.catalog_version < 1 ||
      !Array.isArray(sale.signed_price_proofs) || sale.signed_price_proofs.length === 0 ||
      sale.signed_price_proofs.length > 200 || !Number.isFinite(verifiedAt)) return false;
  try {
    const key = await hmacKey(secret);
    const signed = new Map<string, SignedPriceProof>();
    for (const proof of sale.signed_price_proofs) {
      if (proof.algorithm !== "HMAC-SHA256" || !isUuid(proof.product_id) || proof.catalog_version !== sale.catalog_version ||
          !Number.isSafeInteger(proof.unit_price_minor) || proof.unit_price_minor < 0 ||
          !Number.isSafeInteger(proof.tax_bps) || proof.tax_bps < 0 || proof.tax_bps > 10000 ||
          !Number.isFinite(Date.parse(proof.issued_at)) || !Number.isFinite(Date.parse(proof.expires_at))) return false;
      const issued = Date.parse(proof.issued_at);
      const expires = Date.parse(proof.expires_at);
      if (issued > verifiedAt + 60_000 || expires <= verifiedAt || expires <= issued ||
          expires - issued > 7 * 86400_000) return false;
      const { signature, ...unsigned } = proof;
      const valid = await crypto.subtle.verify("HMAC", key, fromBase64Url(signature),
        new TextEncoder().encode(unsignedPriceProof(unsigned)));
      if (!valid) return false;
      const prior = signed.get(proof.product_id);
      if (prior && (prior.unit_price_minor !== proof.unit_price_minor || prior.tax_bps !== proof.tax_bps)) return false;
      signed.set(proof.product_id, proof);
    }
    const requiredProducts = new Set(sale.lines.map((line) => line.product_id));
    if (signed.size !== requiredProducts.size) return false;
    return sale.lines.every((line) => {
      const proof = signed.get(line.product_id);
      return !!proof && proof.unit_price_minor === line.unit_price_minor && proof.tax_bps === line.tax_bps;
    });
  } catch { return false; }
}
