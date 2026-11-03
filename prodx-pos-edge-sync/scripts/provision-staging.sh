#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="$ROOT/wrangler.jsonc"
MODE="${1:-provision}"

require() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    printf 'ERROR: required environment variable %s is missing\n' "$name" >&2
    exit 2
  fi
}

case "$MODE" in
  provision)
    require CLOUDFLARE_API_TOKEN
    require CLOUDFLARE_ACCOUNT_ID
    require STAGING_DATABASE_URL
    require STAGING_DATABASE_HOST_EXPECTED
    require STAGING_DATABASE_NAME_EXPECTED
    require POS_STAGING_ACCESS_AUD
    ;;
  set-secret)
    require CATALOG_SIGNING_KEY
    if [[ "${#CATALOG_SIGNING_KEY}" -lt 32 ]]; then
      echo "ERROR: CATALOG_SIGNING_KEY must be at least 32 characters" >&2
      exit 2
    fi
    ;;
  *)
    echo "Usage: $0 [provision|set-secret]" >&2
    exit 2
    ;;
esac

cd "$ROOT"

if [[ "$MODE" == "provision" ]]; then
  mapfile -t DB_TARGET < <(node -e '
    const u = new URL(process.env.STAGING_DATABASE_URL);
    if (!["postgres:", "postgresql:"].includes(u.protocol)) process.exit(2);
    process.stdout.write([
      u.hostname.toLowerCase(),
      decodeURIComponent(u.pathname.replace(/^\\//, "")),
      String(Number(u.port || 5432)),
    ].join("\\n"));
  ')
  DB_HOST="${DB_TARGET[0]:-}"
  DB_NAME="${DB_TARGET[1]:-}"
  DB_PORT="${DB_TARGET[2]:-}"
  [[ -n "$DB_HOST" && "$DB_HOST" == "${STAGING_DATABASE_HOST_EXPECTED,,}" ]] || {
    echo "ERROR: Staging database host does not match the exact approved host allowlist" >&2
    exit 1
  }
  [[ -n "$DB_NAME" && "$DB_NAME" == "$STAGING_DATABASE_NAME_EXPECTED" ]] || {
    echo "ERROR: Staging database name does not match the exact approved database allowlist" >&2
    exit 1
  }
fi

if [[ "$MODE" == "set-secret" ]]; then
  # Secret value is piped through stdin and never echoed to logs.
  printf '%s' "$CATALOG_SIGNING_KEY" | npx wrangler secret put CATALOG_SIGNING_KEY --env staging
  echo "Staging CATALOG_SIGNING_KEY updated."
  exit 0
fi

api() {
  local method="$1" path="$2"
  shift 2
  curl --fail --silent --show-error \
    --request "$method" \
    --url "https://api.cloudflare.com/client/v4$path" \
    --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    --header "Content-Type: application/json" "$@"
}

queue_exists() {
  local queue_name="$1"
  api GET "/accounts/$CLOUDFLARE_ACCOUNT_ID/queues?per_page=100" |
    jq -e --arg n "$queue_name" '.result[]? | select((.queue_name // .name) == $n)' >/dev/null
}

ensure_queue() {
  local queue_name="$1"
  if queue_exists "$queue_name"; then
    printf 'Queue exists: %s\n' "$queue_name"
  else
    printf 'Creating staging queue: %s\n' "$queue_name"
    npx wrangler queues create "$queue_name"
    queue_exists "$queue_name" || {
      echo "ERROR: queue creation was not visible after create: $queue_name" >&2
      exit 1
    }
  fi
}

hyperdrive_id() {
  local name="$1"
  api GET "/accounts/$CLOUDFLARE_ACCOUNT_ID/hyperdrive/configs?per_page=100" |
    jq -r --arg n "$name" '.result[]? | select(.name == $n) | .id' | head -n1
}

validate_hyperdrive() {
  local name="$1" id="$2" expected_caching_disabled="$3"
  local config
  config="$(api GET "/accounts/$CLOUDFLARE_ACCOUNT_ID/hyperdrive/configs/$id")"
  jq -e \
    --arg name "$name" \
    --arg host "$DB_HOST" \
    --arg database "$DB_NAME" \
    --argjson port "$DB_PORT" \
    --argjson caching_disabled "$expected_caching_disabled" \
    '.success == true
      and .result.name == $name
      and ((.result.origin.host // "") | ascii_downcase) == $host
      and .result.origin.database == $database
      and (.result.origin.port // 5432) == $port
      and (.result.origin.scheme == "postgres" or .result.origin.scheme == "postgresql")
      and (.result.caching.disabled // false) == $caching_disabled' \
    <<<"$config" >/dev/null || {
      echo "ERROR: existing Hyperdrive $name does not match the exact approved Staging origin/caching policy" >&2
      exit 1
    }
}

ensure_hyperdrive() {
  local name="$1" caching="$2" id
  id="$(hyperdrive_id "$name")"
  if [[ -n "$id" ]]; then
    printf 'Hyperdrive exists: %s (%s)\n' "$name" "$id" >&2
    printf '%s' "$id"
    return
  fi

  printf 'Creating staging Hyperdrive: %s\n' "$name" >&2
  local output
  if [[ "$caching" == "disabled" ]]; then
    output="$(npx wrangler hyperdrive create "$name" --connection-string="$STAGING_DATABASE_URL" --caching-disabled 2>&1)" || {
      printf '%s\n' "$output" >&2
      return 1
    }
  else
    output="$(npx wrangler hyperdrive create "$name" --connection-string="$STAGING_DATABASE_URL" 2>&1)" || {
      printf '%s\n' "$output" >&2
      return 1
    }
  fi
  id="$(hyperdrive_id "$name")"
  if [[ -z "$id" ]]; then
    printf '%s\n' "$output" >&2
    echo "ERROR: could not resolve Hyperdrive ID after creation: $name" >&2
    return 1
  fi
  validate_hyperdrive "$name" "$id" "$([[ "$caching" == "disabled" ]] && echo true || echo false)"
  printf '%s' "$id"
}

# Ensure the account ID in the repo config matches the explicitly selected
# staging account. This prevents accidental provisioning against another account.
CONFIG_ACCOUNT="$(jq -r '.account_id // empty' "$CONFIG")"
if [[ "$CONFIG_ACCOUNT" != "$CLOUDFLARE_ACCOUNT_ID" ]]; then
  echo "ERROR: CLOUDFLARE_ACCOUNT_ID does not match wrangler.jsonc account_id" >&2
  exit 1
fi

ensure_queue "prodx-pos-ingest-staging"
ensure_queue "prodx-pos-ingest-dlq-staging"

DIRECT_ID="$(ensure_hyperdrive "prodx-pos-edge-direct-staging" disabled)"
CACHED_ID="$(ensure_hyperdrive "prodx-pos-edge-cached-staging" enabled)"

[[ "$DIRECT_ID" =~ ^[a-f0-9]{32}$ ]] || { echo "ERROR: invalid DIRECT Hyperdrive ID" >&2; exit 1; }
[[ "$CACHED_ID" =~ ^[a-f0-9]{32}$ ]] || { echo "ERROR: invalid CACHED Hyperdrive ID" >&2; exit 1; }

# Wrangler JSONC currently contains no comments; jq safely writes a valid JSON
# config for this CI workspace only. The generated resource IDs are not committed.
TMP="$(mktemp)"
jq --arg direct "$DIRECT_ID" --arg cached "$CACHED_ID" \
   --arg aud "$POS_STAGING_ACCESS_AUD" \
   '.env.staging.hyperdrive |= map(if .binding == "HYPERDRIVE_DIRECT" then .id=$direct elif .binding == "HYPERDRIVE_CACHED" then .id=$cached else . end)
    | .env.staging.vars.ACCESS_AUD=$aud' \
   "$CONFIG" > "$TMP"
mv "$TMP" "$CONFIG"

echo "Staging resources are ready. Durable Object SQLite namespace will be created by the staging migration during deploy."
echo "Worker: prodx-pos-edge-sync-staging"
echo "Queues: prodx-pos-ingest-staging, prodx-pos-ingest-dlq-staging"
echo "Hyperdrive DIRECT/CACHED bindings injected into the ephemeral CI config."
