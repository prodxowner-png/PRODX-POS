#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
START_SERVER="$SCRIPT_DIR/start-server.sh"

for option in --project-dir --host --url-host --idle-timeout-minutes; do
  set +e
  output="$(bash "$START_SERVER" "$option" 2>&1)"
  status=$?
  set -e
  if [[ "$status" -ne 2 ]]; then
    printf 'FAIL: %s without a value returned %s (expected 2)\n%s\n' "$option" "$status" "$output" >&2
    exit 1
  fi
  if [[ "$output" != *"$option requires a non-empty value"* ]]; then
    printf 'FAIL: %s did not report its missing value\n%s\n' "$option" "$output" >&2
    exit 1
  fi
done

for option in --project-dir --host --url-host --idle-timeout-minutes; do
  set +e
  output="$(bash "$START_SERVER" "$option" --foreground 2>&1)"
  status=$?
  set -e
  if [[ "$status" -ne 2 ]]; then
    printf 'FAIL: %s followed by another option returned %s (expected 2)\n%s\n' "$option" "$status" "$output" >&2
    exit 1
  fi
done

printf 'start-server argument validation: PASS\n'
