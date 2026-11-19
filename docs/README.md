# PRODX POS — Production Documentation

**Status:** Evidence-driven engineering documentation  
**Source of truth:** `Prodx-organization/PRODX-POS`  
**Documentation reconciliation review:** 2026-10-17  
**Last recorded engineering snapshot:** 2026-10-15; see its evidence limitations below.

PRODX POS is a production-oriented retail POS platform. A documented capability is not automatically an implemented or production-verified capability.

> Use **Verified** only for current repository/CI/operational evidence, **Planned** for approved future capability, **Blocked** for an unresolved required dependency/gate, and **Unverified** when evidence is missing or indirect.

## Principles

Financial integrity · Inventory integrity · Security by default · Multi-tenant isolation · Offline resilience · Auditability · Idempotency · Server authority.

## Documentation map

- [Documentation reconciliation review — 2026-10-17](DOCUMENTATION-REVIEW-2026-10-17.md): evidence inspected, limits of this review, and follow-up required.
- [Engineering status snapshot — 2026-10-15](STATUS-2026-10-15.md): historical repository/PR snapshot and recorded blockers. Its PR states and operational claims must be rechecked against current evidence before use.
- [Production Handbook](PRODUCTION-HANDBOOK.md): architecture, security, database, testing, operations, and release gates.
- [Agent Engineering Skills](engineering-skills/README.md): which evidence-first skill to apply for each change type.
- [Full documentation index](SUMMARY.md).

The repository also contains architecture decisions, auth/RBAC/device-session foundations, database recovery guidance, and agent operating rules. These documents explain the required behavior; they do not replace tests or runtime evidence.

## Evidence and change control

- Record gate results against the exact candidate commit SHA.
- Use **BLOCKED** for unavailable infrastructure/access and **UNVERIFIED** for missing or indirect proof.
- A required gate that is not PASS prevents a Production Ready decision.
- Repository scripts describe available checks; they do not prove those checks ran or passed.
- Do not merge, deploy, change production secrets, or perform destructive recovery actions solely because documentation or code CI is green.
