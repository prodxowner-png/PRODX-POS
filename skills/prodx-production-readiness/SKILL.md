# prodx-production-readiness

## Mission
Aggregate production gates without replacing evidence with confidence.

## Gate model
A gate is PASS only when its required evidence is current, reproducible, and tied to the exact repository head under review.

Required applicable gates:
- Architecture
- Security
- Auth / Authorization
- Database / Migrations
- Financial Integrity
- Inventory Integrity
- Idempotency / Concurrency
- Offline / Sync
- API / Integration
- Tests
- Lint / Typecheck / Build
- CI
- Observability
- Backup / Recovery
- Deployment readiness

## Decision rules
- PASS: all applicable required gates have concrete evidence.
- UNVERIFIED: implementation may exist but evidence is missing/stale/inaccessible.
- FAIL: evidence demonstrates a broken invariant or gate.
- HOLD: any required blocker remains; do not declare Production Ready.

## Evidence format
For every PASS:
- exact commit SHA
- exact test/CI/runtime evidence
- relevant source/migration path
- timestamp or run identifier when applicable

## Hard rules
- Implementation exists != production wired.
- Unit tests pass != production ready.
- CI unavailable != CI passed.
- Do not merge, skip, weaken, or force a gate to obtain PASS.
