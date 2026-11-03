---
name: prodx-distributed-systems
description: Reviews PRODX-POS distributed workflows for consistency, delivery guarantees, transactional messaging, ordering, concurrency, failure recovery, and safe cross-service side effects.
---

# PRODX-POS Distributed Systems Engineering

## Objective

Design and verify workflows that remain correct across process crashes, retries, duplicate or reordered messages, network partitions, concurrent workers, and external-provider uncertainty. Optimize for **exactly-once effect**, not an impossible assumption of exactly-once delivery.

## Non-negotiable rules

- State the consistency requirement for each operation: strong consistency, read-your-writes, monotonic reads, eventual consistency, or explicitly bounded staleness. Do not introduce eventual consistency into money, stock, authorization, or other invariants without an explicit domain decision.
- PostgreSQL remains the source of truth for committed POS business state. Caches, queues, browser storage, provider callbacks, and replicas are not independent authorities.
- Treat network delivery as at-least-once or uncertain. Every retryable consumer must be idempotent using durable message/operation identity, payload fingerprinting, and a database uniqueness/serialization boundary.
- Use a transactional outbox when a database commit must cause a message or external side effect. Persist business state and outbox intent atomically; publish outside the transaction; mark delivery only after the broker/provider confirms the defined acknowledgment.
- Use an inbox/deduplication record for consumed messages when duplicate delivery can repeat effects. Record message identity, consumer/handler scope, payload fingerprint, processing state, and durable outcome consistently with the business mutation.
- Never perform external HTTP, payment-provider calls, broker publishing, or AI-provider calls while a PostgreSQL transaction is open or row locks are held. Keep database transactions short and deterministic.
- Define ordering explicitly per aggregate/resource. Use sequence numbers, versions, partition keys, or compare-and-set checks where causal order matters; do not assume global queue order or wall-clock timestamps provide causality.
- Make concurrent state transitions conditional and monotonic. Use optimistic version checks, row locks, unique constraints, leases with fencing tokens, or another proven database-backed mechanism; process-local mutexes are not distributed coordination.
- A lease alone is not protection against a paused/stale worker. Require a monotonically increasing fencing token or equivalent ownership/version check at the resource that accepts writes.
- Model external outcomes as success, definitive failure, or unknown. A timeout after sending a payment request is unknown, not proof of failure; reconcile by provider reference/idempotency key before issuing another charge or refund.
- Use bounded retries with exponential backoff and jitter, deadlines, cancellation, retry classification, and a terminal/dead-letter path. Do not retry permanent validation, authorization, or invariant failures indefinitely.
- Use circuit breakers and bulkheads to contain dependency failures, but never turn a failed required dependency into a false success or bypass server-side authorization/integrity checks.
- For multi-step workflows spanning independent systems, use an explicit saga/state machine with durable steps, idempotent compensations, timeout/reconciliation handling, and operator-visible stuck states. A compensation is a new business event, not deletion of history.
- Keep event schemas versioned and backward-compatible during rolling deploys. Consumers must handle unknown optional fields and reject unsupported semantic versions safely; deploy consumers/producers in a compatible order.
- Use UTC instants for event metadata and explicit business timezone rules for store-local dates. Do not infer ordering or business-day boundaries from machine-local clocks.
- Propagate correlation/causation IDs, aggregate identity/version, event type/schema version, and trace context. Logs must be structured and redacted; operational telemetry is not a substitute for durable audit records.
- Apply tenant/store authorization at the consumer and application-service boundary using trusted context. A message's tenant/store fields are data to validate, not authorization credentials.

## Review procedure

1. Draw the workflow and identify every process, database, queue, provider, acknowledgment, and retry boundary.
2. Define the business invariant and consistency level for each state transition; identify which store is authoritative.
3. Enumerate failure points: before commit, after commit/before publish, after publish/before acknowledgment, timeout after remote success, duplicate delivery, reordering, worker crash, lease expiry, and partial batch completion.
4. Verify outbox/inbox or equivalent durable handoff, unique constraints, payload fingerprint checks, state transitions, and replay behavior.
5. Inspect concurrency controls, aggregate ordering, version/fencing checks, and transaction duration. Confirm no external I/O occurs inside database transactions.
6. Trace payment, inventory, audit, and authorization effects through the production route/service/domain/repository/provider path.
7. Verify retry/backoff/dead-letter/reconciliation and operator recovery behavior, including stuck and unknown outcomes.
8. Check event schema evolution and rolling-deployment compatibility across old and new producers/consumers.
9. Add real PostgreSQL and broker/provider contract tests where semantics require them; inject crashes and network faults around commit/ack boundaries.
10. Verify the exact commit's CI and runtime evidence. A unit test, mock broker, or successful enqueue is not proof that a distributed effect completed.

## Checklist

- [ ] Each workflow documents its authoritative state store and required consistency guarantees.
- [ ] Delivery guarantees are explicit; no exactly-once-delivery claim is used as a substitute for idempotent effects.
- [ ] Outbox intent is committed atomically with the business mutation where required.
- [ ] Consumers deduplicate durably and reject same-ID/different-payload reuse.
- [ ] Publish/consume acknowledgments correspond to documented durable states.
- [ ] Aggregate ordering and stale-event handling are explicit and tested.
- [ ] Concurrent workers cannot both commit conflicting effects; leases use fencing/version checks where needed.
- [ ] External calls happen outside open database transactions and locks.
- [ ] Unknown payment/provider outcomes reconcile before retrying side effects.
- [ ] Retries are bounded, classified, jittered, observable, and safe after restart.
- [ ] Dead-letter/stuck workflows have an audited, authorized recovery path.
- [ ] Sagas and compensations preserve append-only financial/inventory history.
- [ ] Event schema changes support rolling deploys and replay of retained messages.
- [ ] Tenant/store scope is revalidated by consumers from trusted context.
- [ ] Crash, duplicate, reorder, timeout, partition, and concurrency tests assert persisted business outcomes.
- [ ] Correlation/causation metadata and safe operational alerts cover the workflow.

## Required failure-injection matrix

| Failure point | Required assertion |
| --- | --- |
| Crash before database commit | No business mutation or outbox event remains committed |
| Crash after commit before publish | Outbox dispatcher eventually publishes without duplicating business state |
| Publish succeeds but acknowledgment is lost | Republish is harmless to the consumer |
| Consumer commits but acknowledgment is lost | Redelivery produces one durable business effect |
| Same message ID with changed payload | Reject and raise a security/integrity signal |
| Events arrive out of order | Stale/conflicting transition is rejected or safely deferred |
| Worker lease expires while old worker is paused | Fencing/version check prevents stale worker writes |
| Provider succeeds but client times out | Reconciliation discovers the existing outcome before another side effect |
| Dependency unavailable for an extended period | Bounded retries, backpressure, and alerting prevent unbounded resource growth |
| Process restarts mid-batch | Completed items remain completed; remaining items resume idempotently |

## Evidence contract

For every claim, record the exact commit SHA, workflow diagram or state machine, source paths for producer/outbox/dispatcher/consumer/inbox, database constraints, provider/broker contract, test names and commands, CI run URL/conclusion, and runtime traces or audit references where applicable.

Use **PASS** only when direct evidence proves the criterion; **FAIL** when direct evidence demonstrates a violated invariant; **BLOCKED** when required infrastructure/access is unavailable; **UNVERIFIED** when evidence is absent, stale, mocked, or insufficient; and **NOT APPLICABLE** only with a documented reason. A queued message, successful HTTP response, unit test, or green build alone does not prove end-to-end completion or Production Readiness.

## Output format

- **Workflow / invariant:** business effect and authoritative state
- **Delivery and consistency model:** guarantees and explicit limitations
- **Production path:** route/producer → application service → domain → repository/outbox → dispatcher/provider → consumer/inbox → persisted effect
- **Failure modes tested:** crash, retry, duplicate, reorder, timeout, partition, concurrency, and recovery
- **Decision:** PASS / FAIL / BLOCKED / UNVERIFIED / NOT APPLICABLE
- **Evidence:** exact SHA, paths, constraints, commands, CI/runtime references
- **Remaining risks / next action:** owner, dependency, and safest remediation
