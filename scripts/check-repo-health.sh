#!/usr/bin/env bash
# Pre-commit / CI sanity check.
#
# Catches the two classes of issue that bit us in May 2026:
#   1. Stale merge conflict markers (<<<<<<< HEAD / =======/ >>>>>>>)
#      living in tracked source files — these compile-bomb the server.
#   2. Syntax-level breakage in the critical files.
#
# Exits non-zero on any failure so it can be wired into a pre-commit hook.

set -e
cd "$(dirname "$0")/.."

fail=0

echo "→ Scanning for unresolved merge conflict markers…"
# Look for the canonical 7-character markers at the start of a line. Skip
# scripts/ itself (this file documents the markers as a string).
if grep -RnE '^(<<<<<<<|=======|>>>>>>>)\s' \
     --include='*.js' --include='*.jsx' --include='*.ts' --include='*.tsx' \
     --include='*.json' --include='*.css' --include='*.html' --include='*.md' \
     --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist \
     --exclude-dir=scripts \
     . ; then
  echo "✗ Found unresolved merge conflict markers above."
  fail=1
fi

echo "→ Syntax-checking server/index.js…"
if ! node --check server/index.js; then
  echo "✗ server/index.js failed parse."
  fail=1
fi

echo "→ Parsing src/App.jsx with esbuild…"
if ! npx --yes --quiet esbuild src/App.jsx --loader:.jsx=jsx --bundle=false \
       --log-level=error --outfile=/tmp/_check_app.js > /dev/null 2>&1; then
  echo "✗ src/App.jsx failed esbuild parse — running with full output:"
  npx --yes esbuild src/App.jsx --loader:.jsx=jsx --bundle=false --log-level=error --outfile=/tmp/_check_app.js
  fail=1
fi

echo "→ Parsing src/ReportsAnalytics.jsx with esbuild…"
if ! npx --yes --quiet esbuild src/ReportsAnalytics.jsx --loader:.jsx=jsx --bundle=false \
       --log-level=error --outfile=/tmp/_check_ra.js > /dev/null 2>&1; then
  echo "✗ src/ReportsAnalytics.jsx failed parse."
  fail=1
fi

echo "→ Parsing src/OdInsights.jsx with esbuild…"
if ! npx --yes --quiet esbuild src/OdInsights.jsx --loader:.jsx=jsx --bundle=false \
       --log-level=error --outfile=/tmp/_check_oi.js > /dev/null 2>&1; then
  echo "✗ src/OdInsights.jsx failed parse."
  fail=1
fi

echo "→ Parsing src/entryQueue.js with esbuild…"
if ! npx --yes --quiet esbuild src/entryQueue.js --bundle=false \
       --log-level=error --outfile=/tmp/_check_eq.js > /dev/null 2>&1; then
  echo "✗ src/entryQueue.js failed parse."
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo ""
  echo "✓ Repo health checks all passed."
fi
exit "$fail"
