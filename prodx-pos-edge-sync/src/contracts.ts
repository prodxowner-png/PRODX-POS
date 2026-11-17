export interface SaleLine {
  product_id: string;
  quantity: number;
  unit_price_minor: number;
  tax_bps: number;
}

export interface SignedCatalogItem {
  product_id: string;
  sku: string;
  name: string;
  product_version: number;
  unit_price_minor: number;
  tax_bps: number;
}

export interface SignedCatalogSnapshot {
  catalog_version: number;
  issued_at: string;
  expires_at: string;
  items: SignedCatalogItem[];
  signature: string;
  algorithm: "HMAC-SHA256";
}

export interface SignedPriceProof {
  algorithm: "HMAC-SHA256";
  catalog_version: number;
  issued_at: string;
  expires_at: string;
  product_id: string;
  unit_price_minor: number;
  tax_bps: number;
  signature: string;
}

export interface HybridLogicalClock {
  physical_ms: number;
  logical: number;
}

export interface DeviceSignature {
  algorithm: "ECDSA-P256-SHA256";
  key_id: string;
  signature: string; // 64-byte IEEE-P1363 base64url unpadded, low-S
  issued_at: string;
  nonce: string;
}

export interface DeviceSignatureEnvelope {
  domain: "prodx-pos-device-sale-signature/v1";
  protocol: "prodx-pos-device-sale/v1";
  key_id: string;
  tenant_id: string;
  terminal_id: string;
  sale_id: string;
  terminal_seq_no: number;
  payload_hash: string;
  issued_at: string;
  nonce: string;
}

export interface CanonicalSalePayload {
  domain: "prodx-pos-device-sale-payload/v1";
  protocol: "prodx-pos-device-sale/v1";
  sale: Record<string, unknown>;
  tenant_id: string;
  terminal_id: string;
}

export interface OfflineSalePayment {
  id: string;
  method: "cash" | "card" | "qr";
  amount_minor: number;
  tendered_cash_minor?: number;
  change_given_minor?: number;
  auth_code?: string;
  card_last_four?: string;
  terminal_reference?: string;
}

export interface OfflineSale {
  idempotency_key: string;
  payload_hash: string;
  sale_id: string;
  terminal_seq_no: number;
  hlc: HybridLogicalClock;
  catalog_version: number;
  signed_price_proofs: SignedPriceProof[];
  client_recorded_at: string;
  currency: string;
  lines: SaleLine[];
  payments?: OfflineSalePayment[];
  device_signature?: DeviceSignature;
}

export interface SyncBatch { batch_id: string; sales: OfflineSale[]; }
export interface QueueSale {
  tenant_id: string; terminal_id: string; idempotency_key: string;
  payload_hash: string; do_name: string; sale: OfflineSale;
  edge_received_at: string; receipt_id: string;
}
export interface AuthContext { tenantId: string; terminalId: string; subject: string; }
export interface TerminalCheckpoint {
  last_committed_seq_no: number;
  last_hlc_physical_ms: number;
  last_hlc_logical: number;
}
export interface PreparedSale {
  sale: OfflineSale; payloadHash: string; edgeReceivedAt: string; receiptId: string;
}
export interface IdempotencySubmission {
  tenantId: string; terminalId: string; doName: string; sales: PreparedSale[];
}
export interface IdempotencyBatchResult {
  results: IdempotencyResultItem[];
  sequence_gaps: Array<{ from_seq_no: number; to_seq_no: number }>;
  last_contiguous_seq_no: number;
  last_hlc: { physical_ms:number; logical:number };
}
export interface IdempotencyResultItem {
  idempotency_key: string; status: "accepted" | "duplicate" | "committed";
  receipt_id: string; payload_hash: string;
}
