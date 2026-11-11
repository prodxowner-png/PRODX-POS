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
- `docs/cf01-device-signature-test-vectors-v1.md`: fixed synthetic JCS bytes, payload/envelope SHA-256 hashes, tenant-binding negative vector, test-only public key, fixed ECDSA P-256 signature, and cross-runtime verification requirements.
- `docs/cf01-quarantine-workflow-contract.md`: detailed Quarantine state machine, evidence integrity, roles, dual-control proposal, disposition rules, retention/SLA/escalation proposal, append-only audit events, and security test matrix.
- `docs/cf01-prodx-checkout-adapter-contract.md`: trusted backend adapter and B1–B8 blockers, corrected to reflect owner-approved Staging authentication and Quarantine decisions.

## Quarantine policy

If a sale is received by the trusted backend after its signing key has been revoked:
1. Never auto-commit it, regardless of client-provided `issued_at`.
2. Preserve original signed bytes, hash, signature, key/device/sequence metadata, and trusted receipt/revocation timestamps as immutable evidence.
3. Append audit events for quarantine, reviewer decisions, and disposition.
4. Only an authorized reviewer in a separate privileged workflow may recommend reconciliation. Revalidate tenant, identity, sequence, idempotency, signed price proof, tender/payment, inventory, and every financial invariant before invoking the existing CheckoutService.
5. Do not reactivate the revoked key or mutate/reuse the original idempotency identity with changed content.
6. Quarantine is non-financial: no order, payment, cash movement, stock decrement, financial ledger row, or committed receipt may be created while a case is pending.

The detailed state machine and tests are in `docs/cf01-quarantine-workflow-contract.md`.

## Proposed operational controls still requiring review

The workflow contract proposes (not yet owner-approved as operational policy):
- two distinct human identities for reconciliation approval as the safe initial default;
- reviewer assignment target within one business day, escalation after three business days, and security/operations owner escalation after ten business days;
- no automatic evidence deletion; pending/overdue evidence remains retained;
- no retention TTL is invented. Final retention must follow the organization's approved financial/security record-retention schedule;
- reviewer role/permission, dual-control thresholds, maximum pending age, final disposition, manual-correction availability, and raw-evidence export permissions require explicit review.

These controls must be resolved before Runtime implementation. SLA expiry never auto-approves, rejects, commits, releases an idempotency identity, or deletes evidence.

## Correction to older contract wording

The older checkout adapter contract's B1 and Section 7 statements describing the Free-plan RFC as unapproved are historical and are superseded for Staging design/protocol work by the owner's approval and the current RFC/protocol. Production mTLS and B1–B8 correctness gates remain unchanged.

## Remaining gates

Runtime implementation remains blocked until:
1. Independent security review accepts protocol and threat model.
2. Quarantine roles, dual-control, retention, SLA/escalation, and disposition contract are reviewed and approved.
3. RFC 8785/ECDSA test vectors pass in all target runtimes.
4. Enrollment, rotation, revocation, recovery, and append-only audit contracts are reviewed.
5. Access `common_name` maps only to server-owned Staging integration-client records.
6. B1–B8 financial/integration blockers are resolved.
7. Exact-head CI is green and independent security review has no unresolved High/Blocking findings.

## Safety boundary

No Runtime code, migration, DB credential, Cloudflare resource/secret, RLS policy, grant, Production configuration, deployment, or merge is authorized by this record. Do not apply `prodx-pos-edge-sync/migrations/001_pos_ledger.sql` to Preview or Production. CF-01 remains HOLD pending implementation gates and isolated live Staging E2E.
