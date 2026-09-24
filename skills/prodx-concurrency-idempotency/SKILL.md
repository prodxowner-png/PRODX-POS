# prodx-concurrency-idempotency

## Mission
Guarantee exactly-once effect for retryable business operations even when delivery is at-least-once.

## Required checks
- [ ] Checkout, payment, refund, void, offline replay, and external callbacks have stable idempotency keys.
- [ ] Idempotency records/effects are protected against races at the database boundary.
- [ ] Concurrent identical requests produce one business effect.
- [ ] Failed operations remain retryable without duplicate effects.
- [ ] Ordering/conflict behavior is explicit for offline replay.
- [ ] Store/tenant scope is part of authorization and idempotency validation where required.
- [ ] Tests cover duplicate, concurrent, timeout, and retry scenarios.

## Evidence
Provide exact database constraints, transaction/service paths, concurrency tests, CI run IDs, and runtime observations.

## Failure conditions
Any race that can create duplicate financial/inventory effects or a retry state that cannot be reconciled safely.

## Output
Status: PASS | UNVERIFIED | FAIL
Evidence: exact paths/tests/CI/runtime
Blockers: concrete unresolved items
