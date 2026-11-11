# CF-01 Staging Device Signature Protocol v1

**Status:** Draft protocol contract — owner-approved for Staging design only  
**Scope:** CF-01 Staging / `PRODX-POS-PREVIEW` only  
**Production boundary:** Production remains on its existing mTLS contract. This application-layer protocol is not equivalent to mTLS.  
**Implementation gate:** Runtime implementation, schema changes, Cloudflare changes/secrets, deployment, merge, and Production changes are not authorized by this document.

## 1. Security model

CF-01 has two independent controls:

1. **Cloudflare Access Service Token:** authenticates the Staging integration client at the Worker ingress. Validate the Access JWT signature with Cloudflare JWKS, exact issuer, dedicated audience, expiry, and not-before. Resolve the JWT `common_name` only to a server-owned integration-client record. It must not be treated as tenant, terminal, register, cashier, or role identity.
2. **Per-device asymmetric signature:** authenticates an enrolled terminal and binds a sale to its immutable content. The backend resolves the supplied `key_id` to an active server-owned public-key record and derives tenant, terminal, store, register, and cashier/session permissions from trusted mappings.

The Access token is not a terminal identity. The terminal key is not an ingress credential. Neither mechanism replaces backend authorization, RLS, sequence checks, or financial validation.

Use a dedicated Access application and audience for the Staging Worker if/when provisioned. Do not reuse a broad `All Workers` application. The connected account's current Free-plan limitations must be rechecked before provisioning. No Access app or secret is created by this protocol work.

## 2. Cryptographic profile

- Protocol ID: `prodx-pos-device-sale/v1`.
- Signature: ECDSA P-256 with SHA-256, WebCrypto algorithm `{ name: "ECDSA", namedCurve: "P-256" }`.
- Wire signature: base64url without padding of exactly 64 bytes, IEEE-P1363 `r || s`. Reject DER, malformed lengths, invalid base64url, and non-canonical encodings.
- Public key: P-256 public JWK only (`kty=EC`, `crv=P-256`, public `x` and `y`). Reject private JWK members. Generate an opaque server-side `key_id`; never derive identity from the key ID itself.
- Private key: generated on terminal, non-exportable in a hardware-backed platform keystore where supported. Store assurance class as server-observed/verified metadata; do not accept an unverified client assertion that a key is hardware-backed.
- Hash: SHA-256 over UTF-8 bytes, encoded as lowercase 64-character hexadecimal.
- Algorithm and encoding are fixed by protocol version; never negotiate them from untrusted request fields.

The terminal private key must be unique per device and must not be shared with catalog signing or backend service authentication.

## 3. Canonicalization and payload hash

Use RFC 8785 JSON Canonicalization Scheme (JCS), not the current ad-hoc recursive key sorter. All runtimes must consume the same byte-level test vectors.

Before canonicalization, strict schema validation must reject:
- unknown fields and duplicate JSON member names;
- invalid UTF-8, invalid Unicode, non-finite numbers, unsafe integers;
- monetary values not represented as integer minor units;
- invalid UUIDs, quantities, tax rates, timestamps, or oversized arrays/strings.

For a validated sale, exclude only the transport envelope fields `payload_hash` and `device_signature`. The payload hash input is the JCS bytes of:

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

The hash must be recomputed at Edge and trusted backend using tenant and terminal values from the enrolled key record, never caller-supplied identity fields.

## 4. Signed envelope

The device signs JCS bytes of this exact envelope:

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

The request contains the sale payload, `key_id`, `issued_at`, `nonce`, `payload_hash`, and `device_signature`. Tenant/terminal identifiers may be included as hints for diagnostics only; they are ignored for authorization and must match server-derived identity if present.

Verification order:
1. Authenticate the Access ingress assertion.
2. Strictly parse and validate request envelope and sale.
3. Resolve `key_id` to an active key record; derive tenant and terminal from that record.
4. Check key status, tenant/device relationship, allowed environment, and revocation state.
5. Recompute payload hash with server-derived tenant/terminal.
6. Rebuild the exact signed envelope and verify ECDSA.
7. Enforce nonce/replay, sequence/HLC, catalog proof, idempotency, and financial invariants.
8. Re-verify the immutable signed fields at trusted backend before financial commit.

A valid signature is not proof of correct price, available stock, payment settlement, active shift, or permission to write a sale.

## 5. Enrollment, rotation, revocation, recovery

Enrollment is a separate authenticated owner/admin workflow, never part of normal sync:

1. Server creates a cryptographically random, single-use, short-lived challenge bound to tenant, terminal, intended operation, and expiry.
2. Terminal generates its key locally and signs the challenge.
3. Backend validates challenge state, proof of possession, public-key profile, tenant/store/register relationship, and uniqueness.
4. Authorized owner/admin approves activation. Persist an append-only audit event.
5. Sync requests cannot create or replace keys.

Lifecycle states: `PENDING`, `ACTIVE`, `ROTATED`, `REVOKED`, `EXPIRED`. Enforce one active key per terminal except a bounded, explicitly configured rotation overlap. Rotation, revocation, and recovery require server-side authorization and audit events. Lost-device recovery must not allow a terminal to self-enroll.

Persist public key and metadata only: key ID, tenant/terminal binding, public key, algorithm, state, lifecycle timestamps, actor, assurance class, and audit reference. Never store/log private keys.

### Offline sale submitted after key revocation — unresolved policy gate

A client-supplied `issued_at` is signed but is not a trusted timestamp. It cannot prove that the sale was signed before revocation.

Choose one policy before Runtime implementation:
- **Strict revocation:** reject every upload after server-observed revocation; legitimate offline sales may require manual reconciliation.
- **Bounded grace:** accept only with independent trusted timestamp/attestation proving signature creation before revocation and within a maximum offline interval.
- **Quarantine:** do not auto-commit; route claimed pre-revocation sales to privileged reconciliation with append-only audit.

Until this decision is made and reviewed, such submissions must not be automatically committed.

## 6. Access Service Token identity mapping

- Verify Access JWT signature, issuer, dedicated audience, expiry, and not-before.
- Require `common_name` and map it to a server-owned Staging integration-client allowlist record.
- The mapping contains environment, Access application/audience, enabled state, and permitted backend route/scope.
- Never map `common_name` directly to tenant or terminal. Tenant/terminal come from the enrolled device key record.
- Human operator/diagnostics endpoints require a separate human authentication and authorization path. Do not infer a POS auditor role from a Service Token.
- Reject unknown, disabled, expired, wrong-audience, or wrong-environment integration clients.

## 7. Replay, sequence, and idempotency

- Signature binds tenant, terminal, sale ID, sequence, payload hash, key ID, and nonce.
- Enforce unique tenant/terminal/sequence and tenant/idempotency-key constraints at the trusted PostgreSQL boundary.
- Same idempotency key + same canonical hash returns the original committed result.
- Same key + different hash or sale ID is a permanent conflict; never overwrite an original receipt.
- Reuse of nonce, sale ID, or sequence with different immutable content is rejected and audited.
- Durable Object state is retry/transport state only; PostgreSQL remains permanent financial and idempotency authority.
- Sequence/HLC, catalog proof, stock, payment/tender, exact-money, active-shift, and audit constraints remain independently enforced.

## 8. Catalog price proof separation

Current catalog proof code uses Worker-local HMAC secret. It is not accepted as the final trust model. Design a separate asymmetric catalog-signing contract:
- signing private key is held only by the trusted backend/catalog signer;
- Edge and backend verifiers receive public keys and key IDs;
- key rotation and catalog version are explicit;
- the backend independently verifies proof and applies a documented offline-price policy;
- device private keys are never reused for catalog signing.

No client-supplied unsigned price, tax, total, or tender settlement assertion becomes authoritative.

## 9. Required adjacent backend and Edge contracts

Before Gate 6, close all of the following:
- Edge must call a trusted backend integration endpoint; no direct Worker writes to legacy financial tables.
- Backend derives organization/store/register/cashier from server-owned identity/device/session mapping.
- Backend re-verifies device signature and price proof, then invokes existing CheckoutService as the only financial write path.
- Checkout idempotency must atomically bind idempotency key to canonical hash, sale ID, terminal ID, and sequence; same-key/different-payload must fail.
- Sequence/HLC authority must be durable and transactionally consistent with financial commit.
- Payment/tender evidence must be explicit; no assumed offline card/QR settlement.
- Inventory non-negativity must hold atomically under concurrent oversell.
- Money/tax arithmetic must use bounded exact integer/BigInt operations and shared rounding vectors.
- Request body cap must be enforced while streaming.
- Queue acceptance is not commit; only authenticated backend committed receipt permits Edge finalization and local outbox acknowledgement.
- Failed DO receipt retention must be bounded without deleting permanent financial/audit history or allowing failed idempotency keys to be reused silently.
- Preserve RLS, least-privilege grants, append-only audit/inventory/cash controls.

Do not apply `prodx-pos-edge-sync/migrations/001_pos_ledger.sql` to Preview or Production. Do not provision Hyperdrive for the legacy direct-write Worker. If Worker only calls backend, Hyperdrive may be unnecessary.

## 10. Cross-runtime test-vector suite

Create fixtures shared by terminal WebCrypto, Cloudflare Worker, backend Node.js, and PostgreSQL integration tests:

- RFC 8785 canonicalization known-answer fixtures: key ordering, nested objects, arrays, Unicode, escaped strings, integer boundaries, and invalid-value rejection.
- Payload-hash vectors including same sale under different tenant/terminal produces different hash.
- ECDSA P-256 known key/public JWK, exact canonical envelope bytes, fixed signature, and one-field-at-a-time tampering.
- Encoding tests for exact 64-byte P1363, malformed base64url, DER rejection, malformed key coordinates.
- Access tests: wrong issuer/audience, expired/not-yet-valid, unknown/disabled `common_name`, cross-environment token.
- Device tests: unknown/expired/revoked key, cross-tenant/terminal substitution, signature mutation, nonce replay, sequence reuse, HLC regression.
- Lifecycle tests: challenge expiry/replay, unauthorized enrollment, rotation overlap expiry, revocation, lost-device recovery, selected offline-after-revocation policy.
- Financial tests: same-key exact replay, same-key/different-payload conflict, concurrent replay, signed historical price, exact tax rounding, concurrent oversell, payment mismatch, RLS isolation, append-only audit.
- End-to-end: Access → Worker → DO/Queue → trusted backend → CheckoutService → committed receipt → Edge acknowledgement; include duplicate delivery and crash/recovery boundaries.

Fixtures must use synthetic IDs and test-only keys, never production credentials or real device private keys.

## 11. Threat model checklist

Review at minimum: stolen device, compromised terminal OS, private-key extraction, malicious tenant, replay, clock skew, lost device, enrollment abuse, operator account compromise, Access token leakage, Worker compromise, queue tampering, key rotation race, revocation race, backend replay, and malicious catalog signer.

## 12. Implementation gate

This protocol is design work only. Runtime implementation requires:
1. independent security review of this protocol and threat model;
2. explicit resolution of offline-after-revocation policy;
3. reviewed RFC 8785 and ECDSA test vectors passing in every target runtime;
4. approved enrollment/rotation/revocation and audit contracts;
5. explicit Access `common_name` to server-owned integration-client mapping;
6. closure of adjacent financial invariants and B1–B8 contracts;
7. exact-head CI green and independent review without unresolved High/Blocking findings.

Only then may a separate implementation plan be proposed. This document does not authorize Runtime code, DB/schema/grant changes, Cloudflare resources/secrets, deployment, merge, paid upgrades, DNS changes, or Production configuration changes.
