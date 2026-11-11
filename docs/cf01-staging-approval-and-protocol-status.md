# CF-01 Staging Approval and Protocol Status Record

**Date:** 2026-11-11  
**PR:** #376 — Draft, not merged  
**Branch:** `feat/cf01-checkout-adapter-contract`  
**Scope:** CF-01 Staging / `PRODX-POS-PREVIEW` only

## Owner decisions

The owner approved:
- Free-plan Staging authentication direction: unique per-terminal asymmetric signing keys plus Cloudflare Access Service Token as a separate ingress control.
- Production mTLS remains unchanged; application-layer signatures are not equivalent to mTLS.
- Quarantine for sales allegedly signed before device-key revocation but uploaded after revocation. Such sales must not auto-commit and must enter privileged, audited reconciliation.

These approvals cover Staging protocol/design and security-test contract work only. They do not authorize Runtime implementation, database/schema/grant changes, Cloudflare resource or secret changes, deployment, merge, paid upgrades, or Production changes.

## Current protocol artifacts

- `docs/edge-sync-free-plan-device-auth-rfc.md`: approved Staging-only direction.
- `docs/cf01-device-signature-protocol-v1.md`: ECDSA P-256/SHA-256, RFC 8785, server-owned identity/key mapping, lifecycle, replay/idempotency, catalog proof separation, threat model, and Quarantine behavior. Low-S, duplicate-member parsing, strict UTF-8, and integer-domain requirements are clarified by the normative canonicalization addendum.
- `docs/cf01-device-signature-test-vectors-v1.md`: canonical low-S positive signature and former high-S signature as a negative vector, plus payload/envelope hashes and cross-runtime test requirements.
- `docs/cf01-signature-canonicalization-hardening.md`: mandatory low-S policy, strict base64url round-trip, duplicate JSON member rejection before materialization, strict UTF-8, interoperable integer rules, and expanded cross-runtime negative-test matrix.
- `docs/cf01-quarantine-workflow-contract.md`: Quarantine state machine, evidence integrity, role separation, disposition rules, retention/SLA/escalation behavior, append-only audit events, and security test matrix. Owner-approved operational decisions are authoritative in `docs/cf01-quarantine-operational-policy-approval.md`; that approval supersedes the earlier proposals in workflow-contract sections 5, 8, and 11 for the decisions it explicitly covers.
- `docs/cf01-quarantine-operational-policy-approval.md`: owner-approved dual-control, no-manual-correction, evidence-retention, human authorization, auditor/export, and SLA policy.
- `docs/cf01-edge-backend-service-identity.md`: separates POS-to-Access ingress identity from Worker-to-Backend service identity.
- `docs/cf01-prodx-checkout-adapter-contract.md`: trusted backend adapter and B1–B8 blockers.

## Quarantine policy

If a sale is received by the trusted backend after its signing key has been revoked:
1. Never auto-commit it, regardless of client-provided `issued_at`.
2. Preserve original signed bytes, hash, signature, key/device/sequence metadata, and trusted receipt/revocation timestamps as immutable evidence.
3. Append audit events for quarantine, reviewer decisions, and disposition.
4. Only an authorized reviewer in a separate privileged workflow may recommend reconciliation. Revalidate tenant, identity, sequence, idempotency, signed price proof, tender/payment, inventory, and every financial invariant before invoking the existing CheckoutService.
5. Do not reactivate the revoked key or mutate/reuse the original idempotency identity with changed content.
6. Quarantine is non-financial: no order, payment, cash movement, stock decrement, financial ledger row, or committed receipt may be created while a case is pending.

## Owner-approved operational controls

The owner approved the following Staging v1 controls on 2026-11-11; see `docs/cf01-quarantine-operational-policy-approval.md` for the normative record:

- Mandatory dual control: two distinct human identities for every reconciliation that can lead to a financial commit. No emergency bypass.
- Manual correction is disabled in Staging v1. Only reject, request/continue evidence review, or revalidate the exact immutable original command through CheckoutService.
- No automatic evidence deletion or invented TTL. Pending/overdue evidence and its original idempotency reservation remain retained. After disposition, retain until an authoritative financial/security retention schedule is approved; missing policy means retain and escalate.
- Reviewer and approver use existing PRODX human authentication and explicit tenant/store permissions. Access Service Token `common_name` is integration-client identity only, never a human role.
- Auditor is read-only over integrity-checked evidence. Raw signed-evidence export is Security-only, reasoned, and append-only audited.
- Operational targets: assign within one business day; escalate after three business days; Security/Operations escalation after ten business days. SLA expiry never approves, rejects, commits, releases idempotency, or deletes evidence.

## Remaining decisions and gates

Runtime implementation remains blocked until:
1. Independent security review accepts the protocol and threat model.
2. Security/Legal/Operations identifies the authoritative financial/security retention schedule and approves the maximum pending-age escalation policy.
3. Exact reviewer/approver/auditor permission identifiers and role bindings are mapped to existing PRODX authentication and tenant/store authorization.
4. RFC 8785/ECDSA test vectors pass in all target runtimes, including low-S/high-S, duplicate escaped JSON member, strict UTF-8, base64url canonicality, and integer-domain cases.
5. Enrollment/rotation/revocation/recovery and append-only audit contracts are reviewed.
6. Access `common_name` maps only to server-owned Staging integration-client records, and Worker-to-Backend service identity is independently authenticated.
7. B1–B8 financial/integration blockers are resolved.
8. Exact-head CI is green and independent security review has no unresolved High/Blocking findings.
9. Isolated live Staging E2E proves Access → Worker → DO/Queue → trusted backend → CheckoutService → committed receipt → Edge acknowledgement, including crash/retry behavior.

## Verification status (2026-11-11)

- The canonical low-S fixture and former high-S fixture were independently checked against the documented P-256 public key and exact envelope bytes. Both pass raw ECDSA mathematical verification; only the low-S fixture meets protocol v1 canonicality.
- Local fixture verification is not cross-runtime verification. WebCrypto, Cloudflare Worker, backend Node.js, and PostgreSQL harness execution remains outstanding.
- PR #376 exact head `76c42cc381a28e1b1524bf36cf0b6cd23669a973`: all 12/12 GitHub Actions check runs completed successfully. This confirms CI on that documentation commit, not cross-runtime signature tests or Staging E2E.
- Copilot review was requested for the exact PR head; no submitted independent review or inline review thread was visible at the last check. Codex review could not complete because the account reached its code-review usage limit.

## Safety boundary

No Runtime code, migration, DB credential, Cloudflare resource/secret, RLS policy, grant, Production configuration, deployment, or merge is authorized by this record. Do not apply `prodx-pos-edge-sync/migrations/001_pos_ledger.sql` to Preview or Production. CF-01 remains HOLD pending implementation gates and isolated live Staging E2E.
