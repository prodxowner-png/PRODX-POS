#!/usr/bin/env bash
# Bisection script to find which test creates unwanted files/state.
# Usage: ./find-polluter.sh <file_or_dir_to_check> <test_pattern>
# Example: ./find-polluter.sh '.git' 'src/**/*.test.ts'
#
# Supports package.json "test" scripts and Node's built-in test runner when
# package.json exposes a server:test script containing --test. Fails closed
# when no supported runner exists or when any test command fails.

set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <file_to_check> <test_pattern>"
  echo "Example: $0 '.git' 'src/**/*.test.ts'"
  exit 1
fi

POLLUTION_CHECK="$1"
TEST_PATTERN="$2"

echo "🔍 Searching for test that creates: $POLLUTION_CHECK"
echo "Test pattern: $TEST_PATTERN"
echo ""

if [[ -e "$POLLUTION_CHECK" ]]; then
  echo "INCONCLUSIVE: pollution already exists before the isolation run."
  echo "Remove or isolate the pre-existing artifact, then rerun."
  exit 2
fi

TEST_PATTERN="${TEST_PATTERN#./}"
TEST_FILES=$(find . \( -path "./$TEST_PATTERN" -o -path "./${TEST_PATTERN//\*\*\//}" \) -type f | sort -u)
if [[ -z "$TEST_FILES" ]]; then
  echo "INCONCLUSIVE: no test files matched '$TEST_PATTERN'."
  exit 2
fi

TOTAL=$(printf '%s\n' "$TEST_FILES" | wc -l | tr -d ' ')
echo "Found $TOTAL test files"
echo ""

run_test_file() {
  local test_file="$1"
  local npm_test_script=""
  local server_test_script=""

  if [[ -f package.json ]]; then
    npm_test_script="$(node -e "const p=require('./package.json'); process.stdout.write(p.scripts?.test || '')" 2>/dev/null || true)"
    server_test_script="$(node -e "const p=require('./package.json'); process.stdout.write(p.scripts?.['server:test'] || '')" 2>/dev/null || true)"
  fi

  if [[ -n "$npm_test_script" ]]; then
    npm test -- "$test_file"
    return
  fi

  if [[ "$server_test_script" == *"--test"* ]]; then
    # Use the same Node test runner and TS loader declared by this repo's
    # server:test script, but target only the current file for isolation.
    node --import tsx --test "$test_file"
    return
  fi

  echo "INCONCLUSIVE: no supported package.json test runner was found." >&2
  echo "Define scripts.test or a Node-based scripts.server:test containing --test." >&2
  return 127
}

COUNT=0
for TEST_FILE in $TEST_FILES; do
  COUNT=$((COUNT + 1))

  if [[ -e "$POLLUTION_CHECK" ]]; then
    echo "INCONCLUSIVE: pollution appeared before test $COUNT/$TOTAL."
    exit 2
  fi

  echo "[$COUNT/$TOTAL] Testing: $TEST_FILE"
  if ! run_test_file "$TEST_FILE"; then
    echo "INCONCLUSIVE: test runner failed for '$TEST_FILE'; no clean result can be reported." >&2
    exit 2
  fi

  if [[ -e "$POLLUTION_CHECK" ]]; then
    echo ""
    echo "🎯 FOUND POLLUTER!"
    echo "   Test: $TEST_FILE"
    echo "   Created: $POLLUTION_CHECK"
    echo ""
    echo "Pollution details:"
    ls -la "$POLLUTION_CHECK"
    echo ""
    echo "To investigate:"
    echo "  npm test -- $TEST_FILE    # Run just this test when scripts.test exists"
    echo "  cat $TEST_FILE            # Review test code"
    exit 1
  fi
done

echo ""
echo "✅ No polluter found - all matched tests ran successfully and left no pollution."
exit 0
