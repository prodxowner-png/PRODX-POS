# CF-01 Quarantine Workflow Contract v1

**Status:** Design proposal for owner/security review  
**Scope:** CF-01 Staging / `PRODX-POS-PREVIEW` only  
**Owner decision:** Quarantine approved on 2026-11-11 for sales uploaded after device-key revocation  
**Production:** No Production authentication or financial workflow changes  
**Implementation:** Not authorized. This document defines a proposed workflow and test contract only.

## 1. Purpose and invariant

A sale presented with a device key that was revoked before the trusted backend receives the sale must not be committed automatically, even if the signed envelope contains an earlier client `issued_at`.

**Core invariant:** a Quarantined sale is evidence, not a financial transaction.

While a case is Quarantined or under review, it must not create or mutate:
- a PRODX order or order items;
- payment, cash movement, refund, or settlement;
- inventory balance or inventory-ledger entries;
- financial idempotency success receipts;
- a checkout success response or POS outbox acknowledgement.

Quarantine is not a second checkout path. Any eventual approved reconciliation must use the existing trusted backend and `CheckoutService` transaction.

## 2. Trigger and authoritative time

Trigger quarantine when the backend resolves the submitted `key_id` to a retained public-key record and determines that the key's authoritative state is `REVOKED` at the time the trusted backend first receives the request.

- Use server-controlled backend/database receipt time and the server-recorded revocation effective time.
- Do not use client `issued_at`, device wall clock, or unsigned Edge timestamps as proof of pre-revocation creation.
- An Edge ingress timestamp may be supporting evidence only if a separately reviewed cryptographic attestation binds it to the exact payload hash and a trusted server clock. No such exception is assumed in v1.
- A request received by the trusted backend after revocation is Quarantined even if a prior Edge/Queue hop accepted it before revocation, unless a future separately approved trusted-timestamp policy explicitly changes this rule.
- Retain revoked public-key records and key identifiers as immutable historical verification evidence. Revocation blocks authorization; it must not erase the ability to investigate the historical signature.

The system may perform bounded parsing and cryptographic evidence checks to classify the request, but it must not treat a valid signature from a revoked key as current device authorization.

## 3. State machine

```text
RECEIVED
  -> QUARANTINED
  -> IN_REVIEW
      -> REJECTED
      -> REVIEW_OVERDUE (workflow-only; evidence retained)
      -> APPROVED_FOR_RECONCILIATION
          -> REVALIDATION_FAILED
          -> READY_FOR_CHECKOUT
              -> COMMITTED (only after CheckoutService commit receipt)
              -> COMMIT_RETRY (retry same immutable command/idempotency)
```

Rules:
- `QUARANTINED` is the initial durable case state. A case must be persisted before returning a durable quarantine receipt.
- `IN_REVIEW` requires an authorized reviewer assignment and an audit event.
- `REVIEW_OVERDUE` is not rejection, expiry of evidence, or permission to commit. It only signals that the review SLA elapsed.
- `APPROVED_FOR_RECONCILIATION` is permission to attempt independent revalidation, not permission to write financial rows.
- `REVALIDATION_FAILED` records a failed check and remains non-financial. It may return to review only through an audited reassignment/review action.
- `READY_FOR_CHECKOUT` is a short-lived internal state after all checks pass. It must not be exposed to POS as committed.
- `COMMITTED` is set only after an authenticated receipt from the existing CheckoutService proves the financial transaction committed.
- `COMMIT_RETRY` may retry only the exact same immutable payload and idempotency identity. It must return the original result if already committed.
- Rejected or overdue cases never delete evidence and never free the original sale/idempotency identity for a different payload.

There is no direct transition from `QUARANTINED`, `IN_REVIEW`, or `APPROVED_FOR_RECONCILIATION` to `COMMITTED`.

## 4. Immutable evidence record

The evidence record should contain only what is necessary to prove what was received and how it was handled:

- case ID and protocol version;
- exact original request bytes (or an integrity-protected immutable representation) and content type;
- canonical payload hash and the canonicalization version;
- device signature, signature encoding/algorithm, `key_id`, and retained public-key version/reference;
- server-resolved tenant, terminal, store/register mapping snapshot and mapping version;
- sale ID, original idempotency key, terminal sequence number, HLC fields, nonce;
- server-side key state and revocation effective timestamp observed at receipt;
- backend receipt timestamp and any separately verified Edge receipt evidence;
- quarantine reason code, risk classification, state history, reviewer actions, decisions, and final disposition;
- links to any eventual CheckoutService order/commit receipt, without copying or fabricating financial success data.

Integrity controls:
- Preserve original signed bytes; never rewrite them to fix a malformed or rejected request.
- Store a content hash and verify it whenever evidence is read or exported.
- Encrypt evidence at rest and in transit; apply least-privilege access and audited reads/exports.
- Never store private device keys, Access Service Token values, or secrets in evidence.
- Minimize or redact unrelated personal/payment data from reviewer views. Preserve the exact signed evidence in the protected evidence store where required for verification and audit.
- Quarantine evidence and case history are append-only. Corrections are new events, not overwrites.

The physical storage technology and any schema are intentionally unspecified; choosing them requires a separate reviewed implementation plan.

## 5. Roles and separation of duties

Proposed role separation:

- **Submitter/device:** may submit a signed sale; cannot view other tenants' cases or approve its own case.
- **Case service:** creates and transitions cases according to deterministic policy; has no independent financial-write authority.
- **Reviewer:** may read assigned cases within authorized tenant/store scope, request additional evidence, and record a reasoned recommendation. Cannot edit signed payloads, activate/revoke keys, alter mappings, or write financial rows.
- **Approver:** may approve/reject a reconciliation recommendation under an explicit permission and scope. Cannot change original evidence.
- **Security/device administrator:** manages enrollment and key lifecycle; cannot approve reconciliation of a case involving a key they administered without independent second-person review.
- **Auditor:** read-only access to case/evidence/audit trail; no state mutation or financial authority.

No role is implied by Cloudflare Access Service Token `common_name`. Human review must use the normal authenticated human identity, tenant/store authorization, and explicit permissions.

### Dual control

Proposed safe default: require two distinct human identities for every reconciliation that can result in a financial commit until the organization defines and approves a risk-tier threshold. The submitter, key administrator, first reviewer, and second approver must not collapse into one identity. If two-person approval is unavailable, the case remains Quarantined; there is no emergency auto-commit fallback.

A future risk-tier model may relax dual control for low-risk cases only after explicit owner/security approval and documented thresholds. High-risk cases (including suspicious signatures, tenant/register mismatch, duplicate sequence, price proof anomalies, or material-value thresholds) must always require dual control.

## 6. Review and disposition controls

Before a case can become `READY_FOR_CHECKOUT`, the reconciliation workflow must independently verify:

1. Original bytes and payload hash are unchanged.
2. Signature cryptographically verifies against the retained historical public key; this proves only signature validity, not current authorization.
3. Key revocation event, effective time, actor, and device history are consistent.
4. Tenant, terminal, store, register, cashier/session, and active-shift mappings are server-owned and valid for the sale.
5. Sale ID, nonce, terminal sequence/HLC, and original idempotency key have not been reused or altered.
6. Same idempotency key with same hash resolves to the same original outcome; same key with a different hash is a permanent conflict.
7. Catalog version and asymmetric signed price proof are valid under the approved offline-price policy.
8. Tax, discounts, currency, and totals are recomputed using exact server-side money rules.
9. Tender/payment evidence is complete and valid; an offline client assertion cannot establish card/QR settlement.
10. Inventory availability and non-negative stock invariants hold under the normal transactional concurrency controls.
11. Audit, cash, inventory, RLS, grants, and all existing CheckoutService preconditions remain intact.

Disposition options:
- **Reject:** record reason code and reviewer/approver identities; no financial writes.
- **Approve reconciliation:** permits the exact immutable command to enter the normal CheckoutService path after all checks. It does not permit manual DML.
- **Request evidence:** remains Quarantined/under review; no financial writes.
- **Manual correction:** must be a separate authorized business transaction with its own idempotency key and audit trail. Never mutate the original signed sale to make it pass.

If the original sale cannot pass the normal financial rules, it must not be forced through. The authorized disposition is rejection or a separately documented correction workflow.

## 7. Idempotency and retry behavior

- Reserve a case identity for the original tenant/device/sale/idempotency tuple without recording financial success.
- Bind the case permanently to the original canonical payload hash and signature.
- Exact duplicate upload returns the same Quarantine case/reference and current state.
- Same idempotency key or sale identity with a different hash creates a security conflict event and is rejected; it must not overwrite the case or create another sale.
- Repeated queue deliveries must not create duplicate cases or duplicate reviewer tasks.
- After approved reconciliation, call only the existing CheckoutService with the original immutable command and original idempotency identity.
- If CheckoutService committed but the caller lost the response, retry the exact command and recover the same committed receipt. Never create a second financial transaction.
- A Quarantine receipt must be explicitly typed as `quarantined`, never `accepted`, `committed`, or `success` in a way that the POS could interpret as financial completion.

## 8. Retention, age, SLA, and escalation

No legal or contractual retention duration has been established in this design. Do not invent a deletion TTL.

Proposed retention rules:
- Pending and overdue case evidence is retained until a recorded final disposition; it is never automatically deleted.
- After final disposition, retain evidence and audit references according to the organization's approved financial/security record-retention schedule and applicable law.
- If no approved retention schedule exists, preserve the case and escalate the retention decision; do not silently purge it.
- A review SLA may mark a case `REVIEW_OVERDUE` and trigger escalation, but must never auto-approve, auto-reject, auto-commit, or delete evidence.
- Proposed operational targets for owner review: assign a reviewer within one business day; escalate an unassigned/unreviewed case after three business days; escalate unresolved cases to the security/operations owner after ten business days. These are workflow targets, not evidence-retention periods.
- Define a maximum pending-age escalation policy before Runtime implementation. Reaching that age means owner/security disposition is required; it does not release the idempotency key or erase evidence.

## 9. Required audit events

Append-only events should include:
- `QUARANTINE_CREATED`, `EVIDENCE_HASH_VERIFIED`, `CASE_ASSIGNED`, `CASE_VIEWED`, `EVIDENCE_EXPORTED`;
- `REVIEW_STARTED`, `EVIDENCE_REQUESTED`, `REVIEW_RECOMMENDED`;
- `RECONCILIATION_APPROVED`, `RECONCILIATION_REJECTED`, `DUAL_CONTROL_APPROVED`;
- `REVALIDATION_PASSED`, `REVALIDATION_FAILED`;
- `CHECKOUT_COMMIT_REQUESTED`, `CHECKOUT_COMMIT_CONFIRMED`, `CHECKOUT_COMMIT_RETRY`;
- `CASE_REJECTED`, `CASE_REVIEW_OVERDUE`, `CASE_ESCALATED`, `CASE_DISPOSITIONED`.

Each event should record case ID, actor/service identity, tenant scope, server timestamp, action, reason code, previous/new state, correlation ID, and evidence hash. Do not put secrets or private keys in audit payloads. Audit append failure must fail closed for state transitions that grant review/commit authority.

## 10. Security and abuse cases

Test at least:
- revoked key upload with client timestamp before revocation -> Quarantine, no financial writes;
- revoked key upload with timestamp after revocation -> Quarantine, no financial writes;
- queue accepted before revocation but backend receives after revocation -> Quarantine under v1;
- active key at backend receipt -> normal device verification path; no unnecessary Quarantine;
- deleted/missing historical public key -> hold/reject for security investigation, never auto-commit;
- tampered evidence bytes/hash -> integrity alert and no transition to review approval;
- unauthorized cross-tenant reviewer access -> denied and audited;
- submitter attempts self-approval -> denied;
- same reviewer/approver identity attempts dual control -> denied;
- key administrator attempts unilateral approval -> denied;
- reviewer modifies payload/hash/signature -> impossible; integrity failure;
- approval without price/tender/stock/sequence/idempotency checks -> denied;
- approved case with CheckoutService failure -> remains non-committed; retry exact command only;
- CheckoutService commit succeeds but response is lost -> retry returns same order, one stock decrement, one payment set, one audit event;
- review SLA elapses -> overdue/escalated, evidence retained, no auto-commit;
- retention policy missing -> no deletion;
- rejected case followed by altered payload using same idempotency key -> permanent conflict;
- audit append unavailable -> privileged state transition fails closed.

Every negative test must assert no order/payment/cash/inventory mutation and no false committed receipt.

## 11. Open owner/security decisions before Runtime

The following are proposals requiring explicit review/approval; they are not silently treated as approved:
1. Dual control for all quarantine reconciliations as the initial safe default.
2. Reviewer assignment target of one business day, escalation after three business days, owner/security escalation after ten business days.
3. Whether manual correction is available in the first Staging release or whether all failed reconciliations are rejected.
4. The organization's authoritative financial/security evidence-retention schedule and maximum pending-age escalation rule.
5. Exact reviewer/approver permission names and tenant/store scope.
6. Whether a separate auditor role may export raw signed evidence or only view integrity-checked evidence.

No Runtime implementation may begin until these decisions are resolved, threat-model review is complete, and the full CF-01 implementation gates are met.

## 12. Safety boundary

This contract authorizes design and security-test planning only. It does not authorize Runtime code, DB schema/migrations, grants/RLS changes, Cloudflare resources/secrets, credential creation/reset, deployment, merge, paid-plan upgrades, DNS changes, or Production changes.

Do not apply `prodx-pos-edge-sync/migrations/001_pos_ledger.sql`. Keep Production mTLS unchanged. Keep the existing CheckoutService as the only financial write path. CF-01 remains **HOLD** until B1–B8, independent security review, exact-head CI, and isolated live Staging E2E are complete.
