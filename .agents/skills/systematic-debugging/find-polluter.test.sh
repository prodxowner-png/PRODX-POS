#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(cd "$(dirname "$0")" && pwd)/find-polluter.sh"
ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT

# No configured runner must be inconclusive, never a false clean result.
mkdir -p "$ROOT/no-runner/tests"
printf '%s\n' 'test fixture' > "$ROOT/no-runner/tests/sample.test.js"
(
  cd "$ROOT/no-runner"
  set +e
  bash "$SCRIPT" "$ROOT/no-runner/pollution" 'tests/*.test.js' > "$ROOT/no-runner/output" 2>&1
  status=$?
  set -e
  [[ "$status" -eq 2 ]]
  grep -q 'INCONCLUSIVE: no supported package.json test runner' "$ROOT/no-runner/output"
  ! grep -q 'No polluter found' "$ROOT/no-runner/output"
)

# A failing configured test runner must also be inconclusive.
mkdir -p "$ROOT/failing/tests"
printf '%s\n' 'test fixture' > "$ROOT/failing/tests/sample.test.js"
printf '%s\n' '{"scripts":{"test":"node -e 'process.exit(1)'"}}' > "$ROOT/failing/package.json"
(
  cd "$ROOT/failing"
  set +e
  bash "$SCRIPT" "$ROOT/failing/pollution" 'tests/*.test.js' > "$ROOT/failing/output" 2>&1
  status=$?
  set -e
  [[ "$status" -eq 2 ]]
  grep -q 'INCONCLUSIVE: test runner failed' "$ROOT/failing/output"
)

# A configured runner that succeeds is allowed to produce a clean result.
mkdir -p "$ROOT/passing/tests"
printf '%s\n' 'console.log("test passed")' > "$ROOT/passing/tests/sample.test.js"
printf '%s\n' '{"scripts":{"test":"node --test"}}' > "$ROOT/passing/package.json"
(
  cd "$ROOT/passing"
  bash "$SCRIPT" "$ROOT/passing/pollution" 'tests/*.test.js' > "$ROOT/passing/output" 2>&1
  grep -q 'No polluter found - all matched tests ran successfully' "$ROOT/passing/output"
)

echo "find-polluter regression tests passed"
