#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF' >&2
Usage: scripts/verify-postgres-backup-restore.sh [options]

Options:
  --source <url>               Source PostgreSQL URL (default: $SOURCE_DATABASE_URL or $DATABASE_URL)
  --target <url>               Target PostgreSQL URL (default: $TARGET_DATABASE_URL)
  --report <path>              Optional file path to write sanitized JSON drill report
  --docker-container <name>    Optional Docker container running PostgreSQL (default: $PG_DOCKER_CONTAINER)
  --require-all-force-rls      Require all 37 RLS tables, all 3 FORCE RLS tables, and all 5 immutable triggers
  --allow-non-local            Explicitly allow non-local database hosts (unsafe for production)
  -h, --help                   Show this help message
EOF
}

SOURCE_URL="${SOURCE_DATABASE_URL:-${DATABASE_URL:-}}"
TARGET_URL="${TARGET_DATABASE_URL:-}"
REPORT_PATH=""
DOCKER_CONTAINER="${PG_DOCKER_CONTAINER:-}"
ALLOW_NON_LOCAL="${PRODX_DRILL_ALLOW_NON_LOCAL:-false}"
REQUIRE_ALL_FORCE_RLS="${PRODX_DRILL_REQUIRE_ALL_FORCE_RLS:-false}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source)
      SOURCE_URL="${2:-}"
      shift 2
      ;;
    --target)
      TARGET_URL="${2:-}"
      shift 2
      ;;
    --report)
      REPORT_PATH="${2:-}"
      shift 2
      ;;
    --docker-container)
      DOCKER_CONTAINER="${2:-}"
      shift 2
      ;;
    --require-all-force-rls)
      REQUIRE_ALL_FORCE_RLS="true"
      shift
      ;;
    --allow-non-local)
      ALLOW_NON_LOCAL="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 2
      ;;
  esac
done

if [[ -z "${SOURCE_URL}" || -z "${TARGET_URL}" ]]; then
  echo "ERROR: Both source (--source / SOURCE_DATABASE_URL / DATABASE_URL) and target (--target / TARGET_DATABASE_URL) are required." >&2
  exit 2
fi

if [[ "${SOURCE_URL}" == "${TARGET_URL}" ]]; then
  echo "ERROR: Source and target database URLs must be different." >&2
  exit 2
fi

extract_host() {
  local url="$1"
  local authority="${url#*://}"
  authority="${authority%%/*}"
  authority="${authority%%\?*}"
  authority="${authority##*@}"
  if [[ "${authority}" == \[*\]* ]]; then
    authority="${authority#\[}"
    echo "${authority%%\]*}"
  else
    echo "${authority%%:*}"
  fi
}

is_local_host() {
  local host="$1"
  case "${host}" in
    localhost|127.0.0.1|::1|host.docker.internal)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

SOURCE_HOST="$(extract_host "${SOURCE_URL}")"
TARGET_HOST="$(extract_host "${TARGET_URL}")"

if [[ "${ALLOW_NON_LOCAL}" != "true" ]]; then
  if ! is_local_host "${SOURCE_HOST}" || ! is_local_host "${TARGET_HOST}"; then
    echo "ERROR: Refusing to run backup/restore drill against non-local database host without --allow-non-local." >&2
    exit 2
  fi
fi

# When executing inside a Docker container, localhost:<mapped_port> maps to 127.0.0.1:5432 inside the container.
rewrite_url_for_docker() {
  local url="$1"
  local proto="${url%%://*}"
  local rest="${url#*://}"
  local authority="${rest%%/*}"
  local path_and_query="${rest#*/}"
  local userinfo=""
  local hostport="${authority}"
  if [[ "${authority}" == *@* ]]; then
    userinfo="${authority%@*}@"
    hostport="${authority##*@}"
  fi
  local host="${hostport%%:*}"
  if [[ "${host}" == "127.0.0.1" || "${host}" == "localhost" ]]; then
    echo "${proto}://${userinfo}127.0.0.1:5432/${path_and_query}"
  else
    echo "${url}"
  fi
}

EXEC_SOURCE_URL="${SOURCE_URL}"
EXEC_TARGET_URL="${TARGET_URL}"
DUMP_FILE=""

if [[ -z "${DOCKER_CONTAINER}" ]] && command -v docker >/dev/null 2>&1; then
  SOURCE_AUTHORITY="${SOURCE_URL#*://}"
  SOURCE_AUTHORITY="${SOURCE_AUTHORITY%%/*}"
  SOURCE_AUTHORITY="${SOURCE_AUTHORITY%%\?*}"
  SOURCE_AUTHORITY="${SOURCE_AUTHORITY##*@}"
  SOURCE_PORT="5432"
  if [[ "${SOURCE_AUTHORITY}" == *:* ]]; then
    SOURCE_PORT="${SOURCE_AUTHORITY##*:}"
  fi
  DETECTED_CONTAINER="$(docker ps --format '{{.Names}}\t{{.Ports}}' 2>/dev/null | awk -F'\t' -v pat=":${SOURCE_PORT}->5432/tcp" '$2 ~ pat { print $1; exit }')"
  if [[ -n "${DETECTED_CONTAINER}" ]]; then
    DOCKER_CONTAINER="${DETECTED_CONTAINER}"
  fi
fi

if [[ -n "${DOCKER_CONTAINER}" ]]; then
  EXEC_SOURCE_URL="$(rewrite_url_for_docker "${SOURCE_URL}")"
  EXEC_TARGET_URL="$(rewrite_url_for_docker "${TARGET_URL}")"
  DUMP_FILE="/tmp/prodx-dr-drill-$$.dump"
else
  for bin in pg_dump pg_restore psql; do
    if ! command -v "${bin}" >/dev/null 2>&1; then
      echo "ERROR: Required command '${bin}' not found on PATH. Install postgresql-client or pass --docker-container <name>." >&2
      exit 2
    fi
  done
  WORK_DIR="$(mktemp -d "${TMPDIR:-/var/tmp}/prodx-dr-drill.XXXXXX")"
  DUMP_FILE="${WORK_DIR}/prodx-dr-drill.dump"
fi

cleanup() {
  if [[ -n "${DOCKER_CONTAINER}" ]]; then
    docker exec "${DOCKER_CONTAINER}" rm -f "${DUMP_FILE}" >/dev/null 2>&1 || true
  elif [[ -n "${WORK_DIR:-}" && -d "${WORK_DIR}" ]]; then
    rm -rf "${WORK_DIR}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

run_pg() {
  if [[ -n "${DOCKER_CONTAINER}" ]]; then
    docker exec -i "${DOCKER_CONTAINER}" "$@"
  else
    "$@"
  fi
}

psql_scalar() {
  local db_url="$1"
  local sql="$2"
  run_pg psql "${db_url}" --tuples-only --no-align --set ON_ERROR_STOP=1 --command "${sql}" | tr -d '[:space:]'
}

now_ms() {
  if date +%s%3N >/dev/null 2>&1 && [[ "$(date +%s%3N)" =~ ^[0-9]+$ ]]; then
    date +%s%3N
  else
    echo "$(( $(date +%s) * 1000 ))"
  fi
}

# Detect whether migration 0062 (prodx_payment_webhook_events) is present in source
HAS_0062="$(psql_scalar "${EXEC_SOURCE_URL}" "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'prodx_payment_webhook_events';")"
SOURCE_FORCE_RLS_COUNT="$(psql_scalar "${EXEC_SOURCE_URL}" "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname IN ('prodx_discount_policies','prodx_supervisor_authorizations','prodx_payment_webhook_events') AND c.relforcerowsecurity IS TRUE;")"

# 1. Dump source database
DUMP_STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
DUMP_START_MS="$(now_ms)"
run_pg pg_dump "${EXEC_SOURCE_URL}" \
  --format=custom \
  --no-owner \
  --no-acl \
  --file "${DUMP_FILE}"
DUMP_END_MS="$(now_ms)"
DUMP_FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
DUMP_DURATION_MS="$((DUMP_END_MS - DUMP_START_MS))"

if [[ -n "${DOCKER_CONTAINER}" ]]; then
  DUMP_BYTES="$(docker exec "${DOCKER_CONTAINER}" sh -c "wc -c < '${DUMP_FILE}'" | tr -d '[:space:]')"
else
  DUMP_BYTES="$(wc -c < "${DUMP_FILE}" | tr -d '[:space:]')"
fi

if [[ -z "${DUMP_BYTES}" || "${DUMP_BYTES}" -le 0 ]]; then
  echo "ERROR: Dump file is empty." >&2
  exit 1
fi

# 2. Restore into target database
RESTORE_STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
RESTORE_START_MS="$(now_ms)"
run_pg pg_restore \
  --dbname="${EXEC_TARGET_URL}" \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  --exit-on-error \
  "${DUMP_FILE}"
RESTORE_END_MS="$(now_ms)"
RESTORE_FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
RESTORE_DURATION_MS="$((RESTORE_END_MS - RESTORE_START_MS))"

# 3. Verify schema, migrations, RLS, FORCE RLS, and immutable triggers
PUBLIC_TABLE_COUNT="$(psql_scalar "${EXEC_TARGET_URL}" "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';")"
SOURCE_MIGRATION_COUNT="$(psql_scalar "${EXEC_SOURCE_URL}" "SELECT count(*) FROM public.prodx_schema_migrations;")"
TARGET_MIGRATION_COUNT="$(psql_scalar "${EXEC_TARGET_URL}" "SELECT count(*) FROM public.prodx_schema_migrations;")"

if [[ "${TARGET_MIGRATION_COUNT}" -lt 40 || "${TARGET_MIGRATION_COUNT}" -ne "${SOURCE_MIGRATION_COUNT}" ]]; then
  echo "ERROR: Migration count mismatch or below threshold (source=${SOURCE_MIGRATION_COUNT}, target=${TARGET_MIGRATION_COUNT})." >&2
  exit 1
fi

UNPROTECTED_PRODX_TABLES="$(psql_scalar "${EXEC_TARGET_URL}" "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND left(c.relname, 6) = 'prodx_' AND NOT c.relrowsecurity;")"
if [[ "${UNPROTECTED_PRODX_TABLES}" -ne 0 ]]; then
  echo "ERROR: Expected 0 unprotected public.prodx_* tables after restore, found ${UNPROTECTED_PRODX_TABLES}." >&2
  exit 1
fi

BASELINE_RLS_TABLES_SQL="'prodx_organizations','prodx_stores','prodx_users','prodx_user_credentials','prodx_roles','prodx_role_permissions','prodx_store_memberships','prodx_user_roles','prodx_devices','prodx_sessions','prodx_security_audit_events','prodx_categories','prodx_products','prodx_registers','prodx_shifts','prodx_orders','prodx_order_items','prodx_payments','prodx_inventory_ledger','prodx_cash_movements','prodx_audit_log','prodx_refunds','prodx_refund_items','prodx_payment_attempts','prodx_supervisor_authorizations','prodx_shift_operations','prodx_voids','prodx_inventory_adjustments','prodx_timeclock_credentials','prodx_timeclock_records','prodx_timeclock_operations','prodx_timeclock_auth_attempts','prodx_catalog_pricing_operations','prodx_catalog_import_operations','prodx_tasks','prodx_discount_policies'"
ALL_37_RLS_TABLES_SQL="${BASELINE_RLS_TABLES_SQL},'prodx_payment_webhook_events'"

if [[ "${HAS_0062}" -eq 1 || "${REQUIRE_ALL_FORCE_RLS}" == "true" ]]; then
  EXPECTED_RLS_COUNT=37
  RLS_QUERY_LIST="${ALL_37_RLS_TABLES_SQL}"
else
  EXPECTED_RLS_COUNT=36
  RLS_QUERY_LIST="${BASELINE_RLS_TABLES_SQL}"
fi

RLS_ENABLED_COUNT="$(psql_scalar "${EXEC_TARGET_URL}" "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname IN (${RLS_QUERY_LIST}) AND c.relrowsecurity IS TRUE;")"
if [[ "${RLS_ENABLED_COUNT}" -ne "${EXPECTED_RLS_COUNT}" ]]; then
  echo "ERROR: Expected ${EXPECTED_RLS_COUNT} tenant-sensitive tables with RLS enabled after restore, found ${RLS_ENABLED_COUNT}." >&2
  exit 1
fi

FORCE_RLS_ENABLED_COUNT="$(psql_scalar "${EXEC_TARGET_URL}" "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname IN ('prodx_discount_policies','prodx_supervisor_authorizations','prodx_payment_webhook_events') AND c.relforcerowsecurity IS TRUE;")"
if [[ "${FORCE_RLS_ENABLED_COUNT}" -ne "${SOURCE_FORCE_RLS_COUNT}" ]]; then
  echo "ERROR: FORCE ROW LEVEL SECURITY table count mismatch between source (${SOURCE_FORCE_RLS_COUNT}) and target (${FORCE_RLS_ENABLED_COUNT})." >&2
  exit 1
fi

if [[ "${HAS_0062}" -eq 1 || "${REQUIRE_ALL_FORCE_RLS}" == "true" ]]; then
  EXPECTED_FORCE_RLS_COUNT=3
else
  EXPECTED_FORCE_RLS_COUNT="${SOURCE_FORCE_RLS_COUNT}"
  if [[ "${EXPECTED_FORCE_RLS_COUNT}" -lt 1 ]]; then
    EXPECTED_FORCE_RLS_COUNT=1
  fi
fi

if [[ "${FORCE_RLS_ENABLED_COUNT}" -ne "${EXPECTED_FORCE_RLS_COUNT}" ]]; then
  echo "ERROR: Expected ${EXPECTED_FORCE_RLS_COUNT} tables with FORCE ROW LEVEL SECURITY enabled after restore, found ${FORCE_RLS_ENABLED_COUNT}." >&2
  exit 1
fi

DISCOUNT_FORCE_RLS="$(psql_scalar "${EXEC_TARGET_URL}" "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'prodx_discount_policies' AND c.relforcerowsecurity IS TRUE;")"
if [[ "${DISCOUNT_FORCE_RLS}" -ne 1 ]]; then
  echo "ERROR: Expected FORCE ROW LEVEL SECURITY enabled on prodx_discount_policies after restore." >&2
  exit 1
fi

if [[ "${HAS_0062}" -eq 1 || "${REQUIRE_ALL_FORCE_RLS}" == "true" ]]; then
  EXPECTED_IMMUTABLE_TRIGGER_COUNT=5
  IMMUTABLE_TRIGGER_VALUES="('prodx_audit_log_immutable_guard'),('prodx_security_audit_events_immutable_guard'),('prodx_refund_immutable_guard'),('prodx_void_immutable_guard'),('prodx_payment_webhook_events_no_delete_guard')"
else
  EXPECTED_IMMUTABLE_TRIGGER_COUNT=4
  IMMUTABLE_TRIGGER_VALUES="('prodx_audit_log_immutable_guard'),('prodx_security_audit_events_immutable_guard'),('prodx_refund_immutable_guard'),('prodx_void_immutable_guard')"
fi

IMMUTABLE_TRIGGER_COUNT="$(psql_scalar "${EXEC_TARGET_URL}" "SELECT count(*) FROM (VALUES ${IMMUTABLE_TRIGGER_VALUES}) AS expected(tgname) WHERE EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = expected.tgname AND NOT t.tgisinternal AND t.tgenabled IN ('O', 'A'));")"
if [[ "${IMMUTABLE_TRIGGER_COUNT}" -ne "${EXPECTED_IMMUTABLE_TRIGGER_COUNT}" ]]; then
  echo "ERROR: Expected ${EXPECTED_IMMUTABLE_TRIGGER_COUNT} append-only immutability triggers enabled after restore, found ${IMMUTABLE_TRIGGER_COUNT}." >&2
  exit 1
fi

RLS_VERIFIED_TABLES_JSON="$(psql_scalar "${EXEC_TARGET_URL}" "SELECT COALESCE(json_agg(c.relname ORDER BY c.relname)::text, '[]') FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname IN (${RLS_QUERY_LIST}) AND c.relrowsecurity IS TRUE;")"
FORCE_RLS_VERIFIED_TABLES_JSON="$(psql_scalar "${EXEC_TARGET_URL}" "SELECT COALESCE(json_agg(c.relname ORDER BY c.relname)::text, '[]') FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname IN ('prodx_discount_policies','prodx_supervisor_authorizations','prodx_payment_webhook_events') AND c.relforcerowsecurity IS TRUE;")"

# 4. Verify row count parity across key domain tables
TABLES=(
  prodx_organizations
  prodx_stores
  prodx_products
  prodx_orders
  prodx_order_items
  prodx_payments
  prodx_inventory_ledger
  prodx_audit_log
  prodx_security_audit_events
  prodx_discount_policies
  prodx_supervisor_authorizations
)

if [[ "${HAS_0062}" -eq 1 || "${REQUIRE_ALL_FORCE_RLS}" == "true" ]]; then
  TABLES+=(prodx_payment_webhook_events)
fi

ROW_COUNTS_JSON=""
for tbl in "${TABLES[@]}"; do
  src_cnt="$(psql_scalar "${EXEC_SOURCE_URL}" "SELECT count(*) FROM public.${tbl};")"
  tgt_cnt="$(psql_scalar "${EXEC_TARGET_URL}" "SELECT count(*) FROM public.${tbl};")"
  if [[ "${src_cnt}" -ne "${tgt_cnt}" ]]; then
    echo "ERROR: Row count mismatch on ${tbl} (source=${src_cnt}, target=${tgt_cnt})." >&2
    exit 1
  fi
  if [[ -n "${ROW_COUNTS_JSON}" ]]; then
    ROW_COUNTS_JSON="${ROW_COUNTS_JSON},"
  fi
  ROW_COUNTS_JSON="${ROW_COUNTS_JSON}\"${tbl}\":${tgt_cnt}"
done

# 5. Verify inventory ledger & financial reconciliation
SOURCE_INVENTORY_DELTA_SUM="$(psql_scalar "${EXEC_SOURCE_URL}" "SELECT COALESCE(SUM(quantity_delta), 0)::bigint FROM public.prodx_inventory_ledger;")"
TARGET_INVENTORY_DELTA_SUM="$(psql_scalar "${EXEC_TARGET_URL}" "SELECT COALESCE(SUM(quantity_delta), 0)::bigint FROM public.prodx_inventory_ledger;")"
if [[ "${SOURCE_INVENTORY_DELTA_SUM}" != "${TARGET_INVENTORY_DELTA_SUM}" ]]; then
  echo "ERROR: Inventory ledger SUM(quantity_delta) mismatch (source=${SOURCE_INVENTORY_DELTA_SUM}, target=${TARGET_INVENTORY_DELTA_SUM})." >&2
  exit 1
fi

INVENTORY_MISMATCH_COUNT="$(psql_scalar "${EXEC_TARGET_URL}" "SELECT count(*) FROM (SELECT l.organization_id, l.store_id, l.product_id, SUM(l.quantity_delta) AS ledger_sum FROM public.prodx_inventory_ledger l GROUP BY 1, 2, 3) agg JOIN public.prodx_products p ON p.organization_id = agg.organization_id AND p.store_id = agg.store_id AND p.id = agg.product_id WHERE p.current_stock <> agg.ledger_sum;")"
if [[ "${INVENTORY_MISMATCH_COUNT}" -ne 0 ]]; then
  echo "ERROR: Restored product current_stock does not reconcile with SUM(prodx_inventory_ledger.quantity_delta) for ${INVENTORY_MISMATCH_COUNT} products." >&2
  exit 1
fi

SOURCE_ORDERS_TOTAL="$(psql_scalar "${EXEC_SOURCE_URL}" "SELECT COALESCE(SUM(grand_total_amount), 0)::numeric(18,2) FROM public.prodx_orders;")"
TARGET_ORDERS_TOTAL="$(psql_scalar "${EXEC_TARGET_URL}" "SELECT COALESCE(SUM(grand_total_amount), 0)::numeric(18,2) FROM public.prodx_orders;")"
if [[ "${SOURCE_ORDERS_TOTAL}" != "${TARGET_ORDERS_TOTAL}" ]]; then
  echo "ERROR: Orders SUM(grand_total_amount) mismatch (source=${SOURCE_ORDERS_TOTAL}, target=${TARGET_ORDERS_TOTAL})." >&2
  exit 1
fi

SOURCE_PAYMENTS_TOTAL="$(psql_scalar "${EXEC_SOURCE_URL}" "SELECT COALESCE(SUM(amount), 0)::numeric(18,2) FROM public.prodx_payments;")"
TARGET_PAYMENTS_TOTAL="$(psql_scalar "${EXEC_TARGET_URL}" "SELECT COALESCE(SUM(amount), 0)::numeric(18,2) FROM public.prodx_payments;")"
if [[ "${SOURCE_PAYMENTS_TOTAL}" != "${TARGET_PAYMENTS_TOTAL}" ]]; then
  echo "ERROR: Payments SUM(amount) mismatch (source=${SOURCE_PAYMENTS_TOTAL}, target=${TARGET_PAYMENTS_TOTAL})." >&2
  exit 1
fi

VERIFIED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
REPORT_JSON="$(cat <<EOF
{
  "status": "PASS",
  "verifiedAt": "${VERIFIED_AT}",
  "mode": "$( [[ -n "${DOCKER_CONTAINER}" ]] && echo "docker" || echo "native" )",
  "dump": {
    "startedAt": "${DUMP_STARTED_AT}",
    "finishedAt": "${DUMP_FINISHED_AT}",
    "durationMs": ${DUMP_DURATION_MS},
    "bytes": ${DUMP_BYTES}
  },
  "restore": {
    "startedAt": "${RESTORE_STARTED_AT}",
    "finishedAt": "${RESTORE_FINISHED_AT}",
    "durationMs": ${RESTORE_DURATION_MS}
  },
  "verification": {
    "publicTableCount": ${PUBLIC_TABLE_COUNT},
    "sourceMigrationCount": ${SOURCE_MIGRATION_COUNT},
    "restoredMigrationCount": ${TARGET_MIGRATION_COUNT},
    "unprotectedProdxTableCount": ${UNPROTECTED_PRODX_TABLES},
    "rlsEnabledCoreTableCount": ${RLS_ENABLED_COUNT},
    "rlsExpectedCoreTableCount": ${EXPECTED_RLS_COUNT},
    "rlsVerifiedTables": ${RLS_VERIFIED_TABLES_JSON},
    "forceRlsEnabledTableCount": ${FORCE_RLS_ENABLED_COUNT},
    "forceRlsExpectedTableCount": ${EXPECTED_FORCE_RLS_COUNT},
    "forceRlsVerifiedTables": ${FORCE_RLS_VERIFIED_TABLES_JSON},
    "immutableTriggerCount": ${IMMUTABLE_TRIGGER_COUNT},
    "immutableTriggerExpectedCount": ${EXPECTED_IMMUTABLE_TRIGGER_COUNT},
    "rowCounts": {${ROW_COUNTS_JSON}},
    "reconciliation": {
      "inventoryLedgerDeltaSum": ${TARGET_INVENTORY_DELTA_SUM},
      "inventoryLedgerMismatchCount": ${INVENTORY_MISMATCH_COUNT},
      "ordersGrandTotalAmount": "${TARGET_ORDERS_TOTAL}",
      "paymentsAmountSum": "${TARGET_PAYMENTS_TOTAL}"
    }
  }
}
EOF
)"

if [[ -n "${REPORT_PATH}" ]]; then
  mkdir -p "$(dirname "${REPORT_PATH}")"
  printf '%s\n' "${REPORT_JSON}" > "${REPORT_PATH}"
fi

printf '%s\n' "${REPORT_JSON}"
