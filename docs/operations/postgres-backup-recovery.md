# PostgreSQL Backup & Recovery Runbook

## Scope

This runbook covers the production PostgreSQL recovery drill for PRODX POS.

The database remains the authoritative source of truth for transactional data. Browser/local JSON exports are not a substitute for database backup and restore.

## Backup mechanism

The GitHub Actions workflow `.github/workflows/postgres-recovery-drill.yml` performs a read-only logical backup with:

```text
pg_dump --format=custom --no-owner --no-acl
```

The source connection is supplied only through the GitHub Actions secret:

```text
PRODX_PRODUCTION_DATABASE_URL
```

No database credential is stored in the repository.

## Restore verification

The workflow restores the dump into an ephemeral PostgreSQL instance using `pg_restore --dbname="${TARGET_DATABASE_URL}" --clean --if-exists --no-owner --no-acl --exit-on-error` and fails on restore errors.

It then verifies:

1. the `public` schema can be queried;
2. the `prodx_schema_migrations` table exists and contains the expected applied migrations;
3. Row Level Security (`RLS`) is enabled on all 36 tenant-sensitive tables created by the baseline migrations (and every `public.prodx_*` table has `relrowsecurity = true`); when migration `0065_payment_webhook_inbox_and_discount_force_rls` is applied, the webhook inbox is included for 37 tables; `FORCE ROW LEVEL SECURITY` is required on `prodx_discount_policies` (and on `prodx_payment_webhook_events` when migration 0062 is applied);
4. append-only immutability triggers (`prodx_audit_log_immutable_guard`, `prodx_security_audit_events_immutable_guard`, `prodx_refund_immutable_guard`, `prodx_void_immutable_guard`) remain enabled; the webhook inbox delete guard is additionally required when migration 0062 is applied;
5. dump and restore timings and dump byte size are recorded in a sanitized verification report (`artifacts/recovery-drill-report.json`).

The raw `.dump` file is deleted in an `if: always()` cleanup step and is **never** uploaded as a GitHub Actions artifact. Only `artifacts/recovery-drill-report.json` is uploaded.

For local disposable verification against two local PostgreSQL databases, run:

```bash
scripts/verify-postgres-backup-restore.sh \
  --source "postgresql://postgres:postgres@127.0.0.1:55433/prodx_dr_source" \
  --target "postgresql://postgres:postgres@127.0.0.1:55433/prodx_dr_restore"
```

A successful workflow run against production (with owner approval) is still required before production recovery readiness can be treated as verified.

## Evidence required for Production Readiness

A real production recovery drill must record:

- exact source database/environment;
- dump start/end time;
- dump size;
- restore start/end time;
- restore duration;
- restored migration count;
- workflow run URL and commit SHA;
- operator/date;
- observed RPO and RTO.

Do not invent RPO/RTO targets or claim recovery readiness from the existence of this workflow alone.

## Backup layers

This logical dump is one recovery layer. Production PostgreSQL must also have an infrastructure-native backup/PITR mechanism appropriate to the hosting provider.

The application repository cannot prove provider-side PITR configuration without provider evidence.

## Failure handling

If the drill fails:

1. keep the failure visible;
2. inspect the exact database/restore error;
3. fix the root cause;
4. rerun the drill;
5. retain the successful run as evidence.

Never skip the restore step or mark a failed backup as successful.
