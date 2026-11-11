# CF-01 Quarantine Operational Policy — Owner Approval

**Approved:** 2026-11-11  
**Scope:** CF-01 Staging / PRODX-POS-PREVIEW only  
**Supersedes:** Unresolved proposals in cf01-quarantine-workflow-contract.md sections 5, 8, and 11, solely for the decisions below.  
**Production:** No change.  
**Runtime:** Not authorized.

## Approved operational policy

1. **Dual control is mandatory.** Every reconciliation that can result in a financial commit requires two distinct human identities: one reviewer and a separate approver. The submitter and any key administrator involved in the case cannot collapse into either role where that would violate separation of duties. If the second authorized identity is unavailable, the case remains Quarantined. No emergency bypass.
2. **Manual correction is disabled in the first Staging release.** A case may be rejected, kept under review/request evidence, or approved for revalidation of the exact original immutable command. There is no editing or repair of the signed sale. Any future business correction must be a separate, independently authorized transaction with its own idempotency key and audit trail; that capability is out of scope for the first release.
3. **Evidence is never automatically deleted.** Pending and overdue evidence, its hash, state history, and original sale/idempotency reservation remain retained. No TTL or deletion schedule may be invented. After final disposition, preserve evidence until an authoritative financial/security retention schedule is approved and implemented; absence of a schedule means retain and escalate, not purge.
4. **Human authorization uses existing PRODX identity and scope.** Reviewer and approver must authenticate as distinct human users through the normal PRODX auth path and pass explicit permission checks within the assigned tenant/store scope. Cloudflare Access Service Token common_name authenticates only the Edge integration client; it never confers a human role or approval permission.
5. **Auditor and evidence export.** Auditor access is read-only and limited to integrity-checked evidence views and audit history. Raw signed-evidence export is restricted to explicitly authorized Security personnel, requires a reason, and must append an immutable audited export event. Cross-tenant access is denied.
6. **Review SLA.** Assign a reviewer within one business day. Escalate unassigned/unreviewed cases after three business days. Escalate unresolved cases to the Security/Operations owner after ten business days. These are operational escalation targets, not evidence-retention periods. SLA expiry only changes workflow state and triggers escalation; it never approves, rejects, commits, releases idempotency, or deletes evidence.

## Required invariants

- Quarantine remains non-financial. No order, payment, cash movement, refund/settlement, inventory mutation/ledger entry, financial success receipt, or POS outbox acknowledgement is allowed while the case is pending.
- Any approved reconciliation must revalidate all identity, signature, sequence/HLC, payload-bound idempotency, catalog price proof, tender/payment, shift, stock, RLS/grants, and audit requirements, then call only the existing trusted backend CheckoutService.
- All case state transitions and evidence reads/exports are audited append-only. Audit failure fails closed for privileged transitions.
- Same idempotency identity with changed content is a permanent conflict.
- No direct database DML or second financial ledger is introduced.

## Remaining decisions (still blocking Runtime)

This approval does not invent legal retention periods or the maximum pending-age disposition. Before Runtime implementation, Security/Legal/Operations must identify the applicable retention schedule, approve exact permission identifiers and role bindings, and define maximum-age escalation without automatic deletion. Threat-model and independent security review remain required.

## Safety boundary

This is approval of Staging policy/design only. It does not authorize Runtime code, DB schema/migrations, grants/RLS changes, Cloudflare resources/secrets, credential changes, deployment, merge, paid-plan upgrades, DNS changes, or Production changes. Production mTLS and all Production financial paths remain unchanged. CF-01 remains HOLD until B1–B8, independent security review, exact-head CI, cross-runtime protocol tests, and isolated live Staging E2E pass.
