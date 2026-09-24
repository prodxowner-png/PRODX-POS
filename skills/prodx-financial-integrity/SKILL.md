# prodx-financial-integrity

## Mission
Protect monetary correctness from checkout through payment, refund, and void.

## Required checks
- [ ] Monetary values use exact decimal representation.
- [ ] Subtotal, discount, VAT, rounding, total, payment, change, refund, and void are deterministic.
- [ ] Sale/payment effects are atomic.
- [ ] Retry cannot duplicate a financial effect.
- [ ] Refund cannot exceed refundable amount.
- [ ] Void requires the correct server-side authorization.
- [ ] Financial history is auditable and not silently rewritten.
- [ ] Concurrent checkout/payment/refund cases have integration evidence.
- [ ] Browser-supplied financial authority is never trusted.

## Evidence
Cite exact domain/service/route/database test paths plus exact CI/runtime evidence.

## Failure conditions
Any monetary drift, duplicate financial effect, client-authoritative price/payment decision, or missing concurrency evidence.

## Output
Status: PASS | UNVERIFIED | FAIL
Evidence: exact paths/tests/CI/runtime
Blockers: concrete unresolved items
