#!/usr/bin/env bash
# Run every automated suite and save a run-for-record copy of the results in
# testing/results/<YYYY-MM-DD>/ (verbose text for people, JSON for tooling).
# Usage: bash testing/run-system-tests.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/testing/results/$(date +%F)"
mkdir -p "$OUT"
status=0
run() { # workspace, vitest args...
  local ws="$1"; shift
  (cd "$ROOT/$ws" && npx vitest run "$@" --reporter=verbose >"$OUT/$ws-vitest.txt" 2>&1) || status=1
  (cd "$ROOT/$ws" && npx vitest run "$@" --reporter=json --outputFile="$OUT/$ws-vitest.json" >/dev/null 2>&1) || status=1
  echo "$ws: $(grep -E 'Tests ' "$OUT/$ws-vitest.txt" | tail -1)"
}
run client
run server tests/unit
run apify
(cd "$ROOT/client" && npm run typecheck >"$OUT/client-typecheck.txt" 2>&1 && npm run build >"$OUT/client-build.txt" 2>&1) || status=1
(cd "$ROOT/server" && npx prisma validate >"$OUT/prisma-validate.txt" 2>&1) || status=1
echo "Results written to $OUT"
exit $status
