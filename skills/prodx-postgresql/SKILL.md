# prodx-postgresql

## Mission
Verify PostgreSQL is the authoritative integrity boundary.

## Required checks
- [ ] Money uses NUMERIC/DECIMAL, never floating point.
- [ ] Critical invariants are enforced with FK/UNIQUE/CHECK constraints where applicable.
- [ ] Transaction boundaries are explicit and reviewed.
- [ ] Migrations are deterministic, ordered, idempotent where required, and have a verified rollback/downgrade story.
- [ ] UTC timestamp semantics are explicit.
- [ ] Concurrency-sensitive writes have PostgreSQL integration coverage.
- [ ] Query/index behavior is reviewed for production paths.
- [ ] Backup/restore evidence exists before Production Ready.

## Evidence
Record exact migration paths, tests, CI run IDs, and runtime/database observations.

## Failure conditions
- Client-side enforcement substitutes for a critical DB invariant.
- Duplicate migration heads or non-deterministic migration behavior.
- A required integration test is missing, skipped, or stale.
- PASS is claimed without current evidence.

## Output
Status: PASS | UNVERIFIED | FAIL
Evidence: exact paths/tests/CI/runtime
Blockers: concrete unresolved items
