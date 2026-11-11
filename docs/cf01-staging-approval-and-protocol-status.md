# CF-01 Staging Approval and Protocol Status Record

**Date:** 2026-11-11  
**PR:** #376 — Draft, not merged  
**Branch:** `feat/cf01-checkout-adapter-contract`  
**Scope:** CF-01 Staging / `PRODX-POS-PREVIEW` only

## Owner decisions

The owner approved:
- Free-plan Staging authentication direction: unique per-terminal asymmetric signing keys plus Cloudflare Access Service Token as a separate ingress control.
- Production mTLS remains unchanged; application-layer signatures are not equivalent to mTLS.
- **Quarantine** for sales allegedly signed before device-key revocation but uploaded after revocation. Such sales must not auto-commit and must enter privileged, audited reconciliation.

These approvals cover Staging protocol/design and security-test contract work only. They do not authorize Runtime implementation, database/schema/grant changes, Cloudflare resource or secret changes, deployment, merge, paid upgrades, or Production changes.

## Current protocol artifacts

- `docs/edge-sync-free-plan-device-auth-rfc.md`: approved Staging-only direction.
- `docs/cf01-device-signature-protocol-v1.md`: ECDSA P-256/SHA-256, RFC 8785 canonicalization, signed envelope, server-owned identity/key mapping, lifecycle, replay/idempotency, catalog proof separation, threat model, cross-runtime tests, and approved Quarantine behavior.
- `docs/cf01-prodx-checkout-adapter-contract.md`: trusted backend adapter and B1–B8 correctness blockers.

## Quarantine policy

If a sale is received after its signing key has been revoked:
1. Never auto-commit it.
2. Preserve original signed bytes, hash, signature, key/device/sequence metadata, and transport/receipt timestamps as immutable evidence.
3. Append audit events for quarantine, reviewer decisions, and disposition.
4. Only an authorized reviewer in a separate privileged workflow may approve reconciliation. Revalidate tenant, identity, sequence, idempotency, signed price proof, tender/payment, inventory, and every financial invariant before invoking the existing CheckoutService.
5. Do not reactivate the revoked key or mutate/reuse the original idempotency identity with changed content.

A client-provided `issued_at` is not a trusted timestamp. No grace-period acceptance based on that field is permitted.

Before Runtime implementation, specify and independently review retention, maximum quarantine age, reviewer permission, dual-control requirement for high-risk reconciliation, escalation/expiry, and final disposition semantics.

## Correction to older contract wording

The earlier checkout adapter contract contains historical wording in B1 and Section 7 describing the Free-plan RFC as unapproved. That wording predates owner approval recorded on 2026-11-11 and is superseded for Staging design/protocol work by the approved RFC and protocol document above. It does not relax Production mTLS or B1–B8.

## Remaining gates

Runtime implementation remains blocked until:
1. Independent security review accepts protocol and threat model.
2. Quarantine workflow controls and disposition contract are fully specified and reviewed.
3. RFC 8785/ECDSA test vectors pass in all target runtimes.
4. Enrollment, rotation, revocation, recovery, and append-only audit contracts are reviewed.
5. Access `common_name` maps only to server-owned Staging integration-client records.
6. B1–B8 financial/integration blockers are resolved.
7. Exact-head CI is green and independent review has no unresolved High/Blocking findings.

## Safety boundary

No Runtime code, migration, DB credential, Cloudflare resource/secret, RLS policy, grant, Production configuration, deployment, or merge is authorized by this record. Do not apply `prodx-pos-edge-sync/migrations/001_pos_ledger.sql` to Preview or Production. CF-01 remains HOLD pending implementation gates and isolated live Staging E2E.
