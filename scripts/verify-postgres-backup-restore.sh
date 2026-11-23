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
  --allow-non-local            Explicitly allow non-local database hosts (unsafe for production)
  -h, --help                   Show this help message
EOF
}

SOURCE_URL="${SOURCE_DATABASE_URL:-${DATABASE_URL:-}}"
TARGET_URL="${TARGET_DATABASE_URL:-}"
REPORT_PATH=""
DOCKER_CONTAINER="${PG_DOCKER_CONTAINER:-}"
ALLOW_NON_LOCAL="${PRODX_DRILL_ALLOW_NON_LOCAL:-false}"

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
  WORK_DIR="$(mktemp -d)"
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

RLS_ENABLED_COUNT="$(psql_scalar "${EXEC_TARGET_URL}" "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname IN ('prodx_orders','prodx_order_items','prodx_payments','prodx_refunds','prodx_voids','prodx_shifts','prodx_cash_movements','prodx_inventory_ledger','prodx_audit_log','prodx_security_audit_events','prodx_discount_policies') AND c.relrowsecurity IS TRUE;")"
if [[ "${RLS_ENABLED_COUNT}" -ne 11 ]]; then
  echo "ERROR: Expected 11 core tables with RLS enabled after restore, found ${RLS_ENABLED_COUNT}." >&2
  exit 1
fi

FORCE_RLS_ENABLED_COUNT="$(psql_scalar "${EXEC_TARGET_URL}" "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname IN ('prodx_discount_policies') AND c.relforcerowsecurity IS TRUE;")"
if [[ "${FORCE_RLS_ENABLED_COUNT}" -ne 1 ]]; then
  echo "ERROR: Expected FORCE ROW LEVEL SECURITY enabled on prodx_discount_policies after restore, found ${FORCE_RLS_ENABLED_COUNT}." >&2
  exit 1
fi

IMMUTABLE_TRIGGER_COUNT="$(psql_scalar "${EXEC_TARGET_URL}" "SELECT count(*) FROM (VALUES ('prodx_audit_log_immutable_guard'),('prodx_security_audit_events_immutable_guard'),('prodx_refund_immutable_guard'),('prodx_void_immutable_guard')) AS expected(tgname) WHERE EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = expected.tgname AND NOT t.tgisinternal AND t.tgenabled IN ('O', 'A'));")"
if [[ "${IMMUTABLE_TRIGGER_COUNT}" -ne 4 ]]; then
  echo "ERROR: Expected 4 append-only immutability triggers enabled after restore, found ${IMMUTABLE_TRIGGER_COUNT}." >&2
  exit 1
fi

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
)

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
    "rlsEnabledCoreTableCount": ${RLS_ENABLED_COUNT},
    "rlsExpectedCoreTableCount": 11,
    "forceRlsEnabledTableCount": ${FORCE_RLS_ENABLED_COUNT},
    "forceRlsExpectedTableCount": 1,
    "immutableTriggerCount": ${IMMUTABLE_TRIGGER_COUNT},
    "immutableTriggerExpectedCount": 4,
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
