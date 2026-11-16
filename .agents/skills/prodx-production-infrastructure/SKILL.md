---
name: prodx-production-infrastructure
description: Reviews PRODX-POS production infrastructure, platform wiring, network boundaries, TLS, secrets delivery, health/readiness, capacity, and operational configuration.
---

# PRODX-POS Production Infrastructure Engineering

## Objective

Verify that the infrastructure running PRODX-POS is secure, observable, resilient, capacity-aware, and wired to the intended production services. This skill covers runtime infrastructure and platform configuration; CI/CD release mechanics belong to `prodx-ci-cd`, database invariants to `prodx-postgresql`, and restore/DR drills to `prodx-backup-recovery`.

## Source of truth

- The deployed platform configuration and live runtime are authoritative for operational claims.
- Repository configuration describes intended state, not proof that deployed state matches it.
- Provider dashboards/APIs, deployment metadata, runtime probes, and infrastructure logs are evidence only when tied to the target environment and observation time.
- Never infer production configuration from a preview, local environment, sample file, or stale deployment.

## Non-negotiable rules

- Keep production, staging, preview, and local environments explicitly separated. Verify project/account, region, service, branch, and environment before any action.
- Use least-privilege service identities and scoped, rotated secrets. Keep secrets in the approved platform secret manager/environment configuration; never commit, print, echo, or copy secret values into logs or artifacts.
- Require TLS for public and service-to-service traffic where supported. Validate certificate lifecycle, hostname coverage, redirect behavior, and trusted-proxy configuration; do not trust forwarded headers from arbitrary clients.
- Expose only required ports and routes. Restrict administrative, database, metrics, and internal health endpoints to authorized networks or identities.
- Configure health and readiness separately: liveness detects a stuck process; readiness verifies dependencies required to serve traffic. A failed critical dependency must not be reported as ready.
- Apply explicit CPU, memory, concurrency, connection-pool, request-size, timeout, and rate limits appropriate to the platform. Avoid unbounded queues, retries, and worker concurrency.
- Gracefully handle termination, deploy overlap, cold starts, and instance replacement. Drain requests and release leases/locks without losing durable work.
- Keep runtime configuration deterministic and versioned. Validate required variables at startup, fail closed on missing security-critical configuration, and never silently fall back to mock, demo, or permissive adapters.
- Preserve tenant/store authorization at application and database boundaries. Network isolation is defense in depth, not a replacement for RLS or server authorization.
- Keep external provider calls outside open PostgreSQL transactions. Use durable outbox/inbox patterns for asynchronous handoffs.
- Do not change production domains, DNS, TLS, firewall rules, secrets, scaling, database connectivity, or deployment configuration without explicit authorization and a rollback plan.

## Review procedure

1. Identify the exact target environment, deployed commit SHA, provider project/account, region, services, domains, and runtime identity.
2. Trace the production path: client → edge/CDN/WAF → routing/proxy → application runtime → database/provider/queue. Confirm each hop uses the intended endpoint and authenticated trust boundary.
3. Inspect infrastructure-as-code and platform configuration for public exposure, TLS, headers, CORS, CSP, origin restrictions, secret references, and environment separation.
4. Verify startup validation, health/readiness semantics, graceful shutdown, request/connection timeouts, pool sizing, resource limits, autoscaling, and concurrency limits.
5. Inspect runtime logs/metrics/traces for startup failures, dependency saturation, retry storms, queue age, connection exhaustion, and sensitive-data leakage.
6. Exercise safe staging probes and controlled failure scenarios: unavailable database/provider, exhausted pool, slow dependency, process termination, and cold start. Do not run destructive tests against production.
7. Verify that deploy/rollback behavior preserves backward-compatible configuration and database migration ordering; coordinate with `prodx-ci-cd` and `prodx-backup-recovery`.
8. Compare live configuration and deployed SHA with the intended release. Record drift and remediation without silently applying changes.

## Checklist

- [ ] Environment, provider project/account, region, service, and deployed SHA are positively identified.
- [ ] Public ingress, routes, ports, DNS, proxy trust, CORS, and security headers are least-exposure.
- [ ] TLS certificates, renewal, redirects, and service-to-service transport are verified.
- [ ] Secrets are referenced from approved secret storage, scoped, rotated, and absent from logs/artifacts.
- [ ] Runtime identity and service permissions are least-privileged.
- [ ] Required configuration is validated at startup; unsafe defaults and mock fallbacks fail closed.
- [ ] Liveness/readiness checks are distinct and reflect critical dependency state.
- [ ] CPU, memory, concurrency, connection pools, timeouts, and request limits are bounded.
- [ ] Shutdown, deploy overlap, retry, and queue-drain behavior preserve durable work.
- [ ] Observability covers availability, saturation, errors, latency, and dependency/queue health without leaking secrets.
- [ ] Staging failure-injection and post-deploy smoke evidence exist for the exact release.
- [ ] Rollback and configuration recovery steps are documented and safe for the database schema version.

## Evidence contract

Record the exact commit SHA, target environment, provider project/service/region identifiers (non-secret), deployment ID, observation time, configuration paths, runtime identity, probe commands/results, and relevant sanitized logs/metrics.

Use **PASS** only when direct evidence proves the live target configuration and runtime behavior. Use **FAIL** for a demonstrated unsafe exposure, insecure configuration, or broken runtime invariant; **BLOCKED** when access or required infrastructure is unavailable; **UNVERIFIED** when only repository intent, preview, static inspection, or stale evidence exists; and **NOT APPLICABLE** only with a documented reason.

A configuration file, successful build, preview deployment, or green CI run alone does not prove production infrastructure readiness. Never claim Production Ready from this skill in isolation.
