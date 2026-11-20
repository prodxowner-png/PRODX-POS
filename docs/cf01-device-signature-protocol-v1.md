# CF-01 Staging Device Signature Protocol v1

**Status:** Draft protocol contract — owner-approved for Staging design only  
**Scope:** CF-01 Staging / `PRODX-POS-PREVIEW` only  
**Production boundary:** Production remains on its existing mTLS contract. This application-layer protocol is not equivalent to mTLS.  
**Implementation gate:** Runtime implementation, schema changes, Cloudflare changes/secrets, deployment, merge, and Production changes are not authorized by this document.

## 1. Security model

CF-01 has two independent controls:

1. **Cloudflare Access Service Token:** authenticates the Staging integration client at Worker ingress. Validate JWT signature using Cloudflare JWKS, exact issuer, dedicated audience, expiry, and not-before. Resolve `common_name` only to a server-owned integration-client record; never treat it as tenant, terminal, register, cashier, or role identity.
2. **Per-device asymmetric signature:** authenticates an enrolled terminal and binds a sale to immutable content. Backend resolves `key_id` to an active server-owned public-key record and derives tenant, terminal, store, register, and cashier/session permissions from trusted mappings.

The Access token is not a terminal identity. The terminal key is not an ingress credential. Neither replaces backend authorization, RLS, sequence checks, or financial validation.

Use a dedicated Access application/audience for the Staging Worker if provisioned; do not reuse a broad `All Workers` application. Recheck Free-plan entitlement and quotas before provisioning. No Access app or secret is created by this protocol.

## 2. Cryptographic profile

- Protocol ID: `prodx-pos-device-sale/v1`.
- Signature: ECDSA P-256 with SHA-256, WebCrypto `{ name: "ECDSA", namedCurve: "P-256" }`.
- Wire signature: base64url without padding of exactly 64 bytes, IEEE-P1363 `r || s`; reject DER, malformed lengths, invalid base64url, and non-canonical encodings.
- Public key: P-256 public JWK only (`kty=EC`, `crv=P-256`, public `x` and `y`). Reject private JWK members. Generate opaque server-side `key_id`; do not derive identity from key ID.
- Private key: generated on terminal, non-exportable in hardware-backed keystore where supported. Store assurance class as server-observed/verified metadata; do not accept unverified client assertions.
- Hash: SHA-256 over UTF-8 bytes, lowercase 64-character hexadecimal.
- Algorithm and encoding are fixed by protocol version; never negotiate from untrusted request fields.

Device private keys must not be shared with catalog signing or backend service authentication.

## 3. Canonicalization and payload hash

Use RFC 8785 JSON Canonicalization Scheme (JCS), not ad-hoc recursive key sorting. All runtimes must use identical byte-level test vectors.

Strict schema validation rejects unknown fields, duplicate JSON member names, invalid UTF-8/Unicode, non-finite numbers, unsafe integers, non-integer monetary values, invalid UUIDs/quantities/tax rates/timestamps, and oversized collections.

For a validated sale, exclude only transport envelope fields `payload_hash` and `device_signature`. Hash the JCS bytes of a tenant-bound object:

```json
{
  "domain": "prodx-pos-device-sale-payload/v1",
  "protocol": "prodx-pos-device-sale/v1",
  "tenant_id": "<tenant UUID resolved from enrolled key>",
  "terminal_id": "<terminal UUID resolved from enrolled key>",
  "sale": {
    "idempotency_key": "<stable key>",
    "sale_id": "<sale UUID>",
    "terminal_seq_no": 1,
    "hlc": { "physical_ms": 0, "logical": 0 },
    "catalog_version": 1,
    "signed_price_proofs": [],
    "client_recorded_at": "<RFC3339 timestamp>",
    "currency": "THB",
    "lines": []
  }
}
```

Tenant and terminal values come from the enrolled key record, never caller-supplied identity fields.

## 4. Signed envelope

The terminal signs JCS bytes of this exact envelope:

```json
{
  "domain": "prodx-pos-device-sale-signature/v1",
  "protocol": "prodx-pos-device-sale/v1",
  "key_id": "<server-issued key id>",
  "tenant_id": "<server-resolved tenant UUID>",
  "terminal_id": "<server-resolved terminal UUID>",
  "sale_id": "<sale UUID>",
  "terminal_seq_no": 1,
  "payload_hash": "<lowercase SHA-256 hex>",
  "issued_at": "<RFC3339 timestamp>",
  "nonce": "<base64url 16 cryptographically random bytes>"
}
```

The request contains sale payload, `key_id`, `issued_at`, `nonce`, `payload_hash`, and `device_signature`. Tenant/terminal hints are ignored for authorization and must match server-derived identity if present.

Verification order:
1. Authenticate Access ingress assertion.
2. Strictly parse and validate request.
3. Resolve `key_id`; derive tenant and terminal from server record.
4. Check key state, device relationship, environment, and revocation state.
5. Recompute payload hash using server-derived tenant/terminal.
6. Rebuild exact envelope and verify ECDSA.
7. Enforce nonce/replay, sequence/HLC, catalog proof, idempotency, and financial invariants.
8. Re-verify immutable signed fields at trusted backend before financial commit.

A valid signature does not prove correct price, stock, payment settlement, active shift, or authorization.

## 5. Enrollment, rotation, revocation, recovery

Enrollment is a separate authenticated owner/admin workflow, never part of sync:
1. Server creates a cryptographically random, single-use, short-lived challenge bound to tenant, terminal, intended operation, and expiry.
2. Terminal generates its key locally and signs the challenge.
3. Backend validates challenge state, proof of possession, key profile, tenant/store/register relationship, and uniqueness.
4. Authorized owner/admin approves activation and an append-only audit event is recorded.
5. Sync requests cannot create or replace keys.

Lifecycle states: `PENDING`, `ACTIVE`, `ROTATED`, `REVOKED`, `EXPIRED`. Enforce one active key per terminal except bounded, explicitly configured rotation overlap. Rotation, revocation, and recovery require server authorization and audit. Lost-device recovery must not allow self-enrollment.

Persist public key and metadata only: key ID, tenant/terminal binding, public key, algorithm, state, lifecycle timestamps, actor, assurance class, and audit reference. Never store/log private keys.

### Approved offline-after-revocation policy: Quarantine

**Owner approved on 2026-11-11.** If a sale was allegedly signed while a key was active but reaches the server after that key is revoked:
- Do not auto-commit the sale.
- Place the sale in a dedicated quarantine/reconciliation state.
- Preserve original signed bytes, canonical payload hash, signature, key ID, device/sequence metadata, and receipt/transport timestamps as immutable evidence.
- Append audit events for quarantine, review decisions, and final disposition.
- Only an authorized reviewer using a separate privileged workflow may approve reconciliation. Before any financial commit, independently validate price proof, payment/tender, stock, sequence, tenant, idempotency, and all existing financial invariants; then use the normal CheckoutService path.
- Never reactivate the revoked key or silently reuse the original idempotency key with changed content.
- Rejection/expiry must not delete audit evidence or permit a different payload to reuse the same idempotency identity.

A client-provided `issued_at` is signed but is not a trusted timestamp and cannot prove the sale predates revocation. No trusted timestamp/attestation grace path is assumed.

**Still required before Runtime implementation:** define quarantine record retention, maximum quarantine age, reviewer role/permission, dual-control requirement for high-risk reconciliation, escalation/expiry behavior, and final disposition semantics (commit/reject/manual correction). These must be reviewed and append-only audited.

## 6. Access Service Token identity mapping

- Verify Access JWT signature, issuer, dedicated audience, expiry, and not-before.
- Require `common_name` and map it to a server-owned Staging integration-client allowlist record.
- Mapping contains environment, Access application/audience, enabled state, and permitted backend route/scope.
- Never map `common_name` directly to tenant or terminal; those derive from enrolled device key.
- Human review/diagnostics endpoints require separate human authentication and authorization. Do not infer an auditor role from a Service Token.
- Reject unknown, disabled, expired, wrong-audience, or wrong-environment clients.

## 7. Replay, sequence, and idempotency

- Signature binds tenant, terminal, sale ID, sequence, payload hash, key ID, and nonce.
- Enforce unique tenant/terminal/sequence and tenant/idempotency-key constraints at trusted PostgreSQL boundary.
- Same key + same canonical hash returns original committed result.
- Same key + different hash or sale ID is a permanent conflict.
- Reuse of nonce, sale ID, or sequence with different immutable content is rejected and audited.
- Durable Object state is transport/retry state only; PostgreSQL remains permanent financial and idempotency authority.
- Sequence/HLC, catalog proof, stock, payment/tender, exact-money, active-shift, and audit constraints remain independent.

## 8. Catalog price proof separation

Current catalog proof code uses Worker-local HMAC secret and is not the final trust model. Design a separate asymmetric catalog-signing contract:
- signing private key held only by trusted backend/catalog signer;
- Edge/backend verifiers receive public keys and key IDs;
- key rotation and catalog version are explicit;
- backend independently verifies proof and applies documented offline-price policy;
- device private keys are never reused for catalog signing.

No unsigned client price, tax, total, or tender settlement assertion is authoritative.

## 9. Adjacent backend and Edge contracts

Before Gate 6:
- Edge calls trusted backend integration endpoint; no direct Worker writes to legacy financial tables.
- Backend derives organization/store/register/cashier from server-owned identity/device/session mapping.
- Backend re-verifies device signature and price proof, then invokes existing CheckoutService as only financial write path.
- Checkout idempotency atomically binds key to canonical hash, sale ID, terminal ID, and sequence; same-key/different-payload fails.
- Sequence/HLC authority is durable and transactionally consistent with financial commit.
- Payment/tender evidence is explicit; no assumed offline card/QR settlement.
- Inventory non-negativity holds atomically under concurrent oversell.
- Money/tax arithmetic uses bounded exact integer/BigInt and shared rounding vectors.
- Request body cap is enforced while streaming.
- Queue acceptance is not commit; only authenticated backend committed receipt permits Edge finalization and local outbox acknowledgement.
- Failed DO receipt retention is bounded without deleting permanent financial/audit history or silently reusing failed idempotency keys.
- Preserve RLS, least-privilege grants, append-only audit/inventory/cash controls.

Do not apply `prodx-pos-edge-sync/migrations/001_pos_ledger.sql` to Preview or Production. Do not provision Hyperdrive for the legacy direct-write Worker. If Worker only calls backend, Hyperdrive may be unnecessary.

## 10. Cross-runtime test-vector suite

Shared fixtures for terminal WebCrypto, Cloudflare Worker, backend Node.js, and PostgreSQL integration tests:
- RFC 8785 known-answer fixtures: ordering, nested objects, arrays, Unicode, escaped strings, integer boundaries, invalid-value rejection.
- Payload-hash vectors; same sale under different tenant/terminal must hash differently.
- ECDSA P-256 known key/public JWK, exact canonical envelope bytes, fixed signature, and one-field-at-a-time tampering.
- Encoding tests: exact 64-byte P1363, malformed base64url, DER rejection, malformed key coordinates.
- Access tests: wrong issuer/audience, expired/not-yet-valid, unknown/disabled `common_name`, cross-environment token.
- Device tests: unknown/expired/revoked key, cross-tenant/terminal substitution, signature mutation, nonce replay, sequence reuse, HLC regression.
- Lifecycle tests: challenge expiry/replay, unauthorized enrollment, rotation overlap expiry, revocation, lost-device recovery, quarantine routing, reviewer authorization, dual control, expiry/escalation, and disposition.
- Financial tests: same-key exact replay, same-key/different-payload conflict, concurrent replay, signed historical price, exact tax rounding, concurrent oversell, payment mismatch, RLS isolation, append-only audit.
- End-to-end: Access → Worker → DO/Queue → trusted backend → CheckoutService → committed receipt → Edge acknowledgement; include duplicate delivery and crash/recovery.

Fixtures use synthetic IDs and test-only keys, never production credentials or real device private keys.

## 11. Threat model checklist

Review stolen device, compromised terminal OS, private-key extraction, malicious tenant, replay, clock skew, lost device, enrollment abuse, operator compromise, Access token leakage, Worker compromise, queue tampering, key rotation/revocation race, backend replay, malicious catalog signer, and quarantine reviewer abuse.

## 12. Implementation gate

Runtime implementation requires:
1. Independent security review accepts threat model and protocol.
2. Quarantine retention, reviewer permission, dual-control, maximum age/escalation, and final disposition contracts are specified and reviewed.
3. RFC 8785 and ECDSA known-answer vectors pass in every target runtime.
4. Enrollment/rotation/revocation/recovery and append-only audit contracts are reviewed.
5. Access `common_name` mapping to server-owned Staging integration-client record is specified and tested.
6. B1–B8 financial/integration blockers are resolved in reviewed contracts.
7. Exact-head CI green and independent review has no unresolved High/Blocking finding.

Only then may a separate implementation plan be proposed. This document does not authorize Runtime code, DB/schema/grant changes, Cloudflare resources/secrets, deployment, merge, paid upgrades, DNS changes, or Production configuration changes.
