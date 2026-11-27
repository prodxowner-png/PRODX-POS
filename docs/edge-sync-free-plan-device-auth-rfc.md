# PRODX POS Edge Sync — Free-plan Device Authentication RFC

**Status:** Approved for CF-01 Staging design/protocol work only; Runtime implementation remains gated  
**Approval:** Owner approval recorded on 2026-11-11 in CF-01 issue #375  
**Scope:** Isolated CF-01 Staging using `PRODX-POS-PREVIEW` only  
**Constraints:** Cloudflare Free only; no paid upgrade; no custom domain purchase; preserve tenant isolation, offline resilience, replay resistance, auditability, and server authority. **Production remains on its existing mTLS contract.**

## 1. Why this RFC exists

The current Edge Worker requires Cloudflare-provided client-certificate metadata, verifies the certificate fingerprint, and maps it to an active `terminal_devices` record. The connected Cloudflare account currently has no Access mTLS CA/settings configured, and the Free-plan entitlement for Access mTLS is not established. The Vercel Preview proxy can present a CI integration certificate, but it cannot preserve the original TLS identity of a physical POS terminal.

Do not remove the current certificate check in Production, trust a caller-supplied fingerprint, or replace device identity with a shared bearer secret merely to make Gate 6 pass.

## 2. Approved Staging model: per-device asymmetric signing

For CF-01 Staging only, use application-layer device authentication with a unique asymmetric key pair per terminal, while Cloudflare Access Service Token remains a separate ingress control:

- A terminal generates its own private key. Keep it non-exportable in the strongest platform keystore available (TPM/Secure Enclave/Android Keystore/OS keystore); document the assurance level for devices without hardware-backed storage.
- The server stores only the public key and enrollment metadata, bound to exactly one `tenant_id` and `terminal_id`.
- Enrollment requires an authenticated owner/admin action, a short-lived single-use server challenge, proof of private-key possession, and an auditable approval/revocation record. Never accept a public key supplied during an ordinary sync request as an enrollment.
- Each sale is signed locally so offline sales remain verifiable after reconnection. A batch-level signature may additionally protect transport framing, but must not replace per-sale signatures.
- Use a widely supported WebCrypto signature suite (evaluate ECDSA P-256 first); pin the algorithm and protocol version. Reject algorithm negotiation from untrusted request data.
- Cloudflare Access Service Token is an independent ingress control only. It is not terminal identity and must not be treated as a replacement for per-device signatures.
- This application-layer design is **not equivalent to transport-layer mTLS**.

## 3. Canonical signed-sale contract

Define and version one canonical contract shared by terminal, Edge Worker, Durable Object, Queue consumer, and PostgreSQL integration tests.

1. Canonicalize the sale payload using deterministic key ordering and stable JSON number/string rules.
2. Exclude only the transport fields `payload_hash` and `device_signature` from the hashed payload.
3. Compute a tenant-bound hash over a domain-separated object containing protocol version, `tenant_id`, `terminal_id`, and the canonical sale payload.
4. Sign a domain-separated message containing protocol version, tenant ID, terminal ID, sale ID, terminal sequence number, and the computed payload hash.
5. Verify the hash and signature at the Edge boundary and re-verify the immutable signed fields at the trusted origin before any financial write.
6. Persist the public-key identifier/version, signature algorithm, signature, payload hash, and verification result in auditable metadata. Never persist or log private key material.

The exact byte-level canonicalization, encoding, domain separator, signature format, and key identifier format must be specified in a protocol document and covered by shared test vectors before Runtime implementation. No component may independently invent its own hash input.

## 4. Enrollment, rotation, revocation, and recovery

The design must include:

- Single-use, expiring enrollment challenges bound to tenant, terminal, and intended key.
- Explicit key states: pending, active, rotated, revoked, expired.
- Atomic activation and revocation; revocation must take effect on the next server-authoritative verification.
- Overlapping old/new keys only for a bounded, explicit rotation window; never allow two unrelated active identities for one terminal.
- Recovery for lost/replaced devices that does not allow a terminal to self-enroll a replacement key.
- Offline behavior: already signed sales remain verifiable after reconnect, subject to documented key-validity/revocation policy. The policy must explicitly define whether a sale signed before revocation but uploaded after revocation is accepted, rejected, or routed for review.
- Audit records for enrollment, rotation, revocation, failed signatures, and administrative recovery.

## 5. Replay and idempotency requirements

- Bind each signature to tenant, terminal, sale ID, sequence number, and payload hash.
- Enforce unique tenant/terminal/sequence and tenant/idempotency-key constraints at PostgreSQL.
- Replays with the same key and same hash must return the original committed result; same key with a different hash must fail permanently.
- A valid signature must never bypass sequence/HLC checks, inventory checks, catalog-price proof checks, or PostgreSQL idempotency.
- Add concurrent replay, cross-tenant replay, cross-terminal replay, signature substitution, stale-key, revoked-key, malformed-signature, and sequence-reuse tests.

## 6. Required adjacent correctness fixes

This authentication change must not be used to mask existing Edge Sync blockers. Before Gate 6:

- Align Edge and PostgreSQL to one tenant-bound canonical payload hash contract and prove it in a complete Edge → DO → Queue → PostgreSQL test.
- Enforce inventory non-negativity atomically in PostgreSQL under concurrent oversell; a ledger trigger that simply adds negative deltas is insufficient.
- Replace unsafe floating-point intermediate tax arithmetic with bounded exact integer/BigInt arithmetic and shared rounding rules.
- Enforce the request body cap while streaming; do not buffer an unbounded chunked request before checking size.
- Define bounded retention for failed DO receipts without deleting authoritative financial/audit history or allowing failed keys to be silently reused.
- Fix and test the Staging provisioning/configuration path separately from Production.

## 7. Cloudflare Free operational limits

- Treat Workers, Durable Objects, Queues, and Hyperdrive allowances as hard budgets; validate current account entitlements and quotas before any live test.
- Keep the large 15,000-sale / 3,000-replay workload in CI/disposable PostgreSQL testing unless a separately measured quota budget permits it.
- Use a small, explicit, quota-budgeted Staging fixture with request/Queue/SQL counters and backpressure tests.
- Do not create paid resources, upgrade plans, purchase domains, or trigger unbounded load tests.

## 8. Gates before Runtime implementation

Owner approval authorizes Staging protocol/design and security-test contract work only. It does not authorize Runtime implementation yet. Before Runtime changes:

1. Threat model reviewed: stolen device, compromised terminal OS, key extraction, malicious tenant, replay, clock skew, lost device, and administrative compromise.
2. Protocol spec and cross-runtime canonicalization/signature test vectors reviewed and approved.
3. Enrollment/rotation/revocation lifecycle, offline-after-revocation policy, and audit event contract fully specified.
4. Identity mapping from Cloudflare Access Service Token ingress identity to the Staging request context explicitly defined; never infer tenant/terminal from `common_name` without a server-owned mapping.
5. Security tests specified, including negative and cross-tenant cases.
6. Adjacent financial invariants independently covered: signed price, exact money, stock non-negativity, payload-bound idempotency, sequence/HLC, and audit.
7. Exact-head CI is green and independent security review has no unresolved blocker.

After those gates, Runtime implementation requires a separate implementation review. Real isolated Staging E2E is required before CF-01 can exit HOLD.

## 9. Explicit non-goals and Production boundary

- This RFC does **not** authorize changing, removing, or weakening the current Production mTLS contract.
- Production authentication remains on the existing mTLS path; this Staging approval is not a Production architecture decision.
- This RFC does not authorize deployment, Cloudflare resource/secret creation or modification, DB/schema/grant changes, paid upgrades, DNS changes, or Production configuration changes.
- This RFC is not proof that application-layer signatures are equivalent to transport-layer mTLS. That distinction must remain explicit in the threat model and operational documentation.
