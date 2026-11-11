# CF-01 Staging Approval and Protocol Status Record

**Date:** 2026-11-11  
**PR:** #376 — Draft, not merged  
**Branch:** `feat/cf01-checkout-adapter-contract`  
**Scope:** CF-01 Staging / `PRODX-POS-PREVIEW` only

## Owner decision

The owner approved the Free-plan Staging authentication direction:
- unique per-terminal asymmetric signing keys;
- Cloudflare Access Service Token as a separate ingress control;
- Production mTLS remains unchanged;
- application-layer signatures are not equivalent to mTLS.

Approval is limited to protocol/design and security-test contract work. It does not authorize Runtime implementation, database/schema/grant changes, Cloudflare resource or secret changes, deployment, merge, paid upgrades, or Production changes.

## Current protocol artifact

The detailed protocol contract is maintained in [CF-01 Staging Device Signature Protocol v1](cf01-device-signature-protocol-v1.md). It specifies:
- ECDSA P-256 / SHA-256, fixed wire encoding and protocol version;
- RFC 8785 JCS canonicalization and tenant/terminal-bound payload hashing;
- signed sale envelope, nonce and replay binding;
- Access JWT `common_name` mapped only to a server-owned integration-client allowlist;
- separate enrollment, key rotation, revocation and recovery lifecycle;
- an explicit unresolved offline-after-revocation policy gate;
- catalog-price signing as a separate asymmetric key custody problem;
- shared cross-runtime test vectors and negative security tests;
- financial adapter requirements and explicit implementation gates.

## Correction to older contract text

The earlier checkout adapter contract contains historical wording in B1 and Section 7 that describes the Free-plan RFC as unapproved and says not to implement it without approval. That wording predates the owner's approval recorded on 2026-11-11.

Interpret those statements as superseded by:
1. the owner approval recorded in issue #375;
2. the approved Staging-only RFC in `docs/edge-sync-free-plan-device-auth-rfc.md`;
3. the detailed protocol in `docs/cf01-device-signature-protocol-v1.md`.

This supersession is strictly for Staging protocol/design work. It does not relax the Production mTLS boundary or any B1–B8 correctness/security gate.

## Remaining design gates

Runtime implementation remains blocked until:
1. Independent security review accepts the threat model and protocol.
2. Owner/security reviewer selects strict revocation, bounded trusted-timestamp grace, or quarantine for offline sales uploaded after key revocation.
3. RFC 8785 and ECDSA known-answer vectors pass in terminal, Worker, and backend runtimes.
4. Enrollment, rotation, revocation, recovery, and append-only audit contracts are reviewed.
5. Access `common_name` mapping to a server-owned Staging integration-client record is specified and tested.
6. B1–B8 financial and integration blockers are resolved in reviewed contracts.
7. Exact-head CI is green and independent review has no unresolved High/Blocking finding.

## Safety boundary

No Runtime code, migration, DB credential, Cloudflare resource/secret, RLS policy, grant, Production configuration, deployment, or merge is authorized by this record. Do not apply `prodx-pos-edge-sync/migrations/001_pos_ledger.sql` to Preview or Production. CF-01 remains HOLD pending implementation gates and isolated live Staging E2E.
