#!/usr/bin/env bash
# finish-merge.sh — records the cowork merge work as a proper merge commit.
#
# The working tree already contains the 3-way merged content of your local
# work + origin/main. This script just tells git about it, untracks the
# sqlite binaries (now covered by .gitignore), and pushes.
#
# Safe to run from the project root on your Mac:
#     cd /path/to/odpulse
#     bash finish-merge.sh
#
# A rollback hint is printed at the end in case something looks wrong.

set -euo pipefail

cd "$(dirname "$0")"

BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "main" ]; then
  echo "ERROR: not on main (currently on $BRANCH). Aborting."
  exit 1
fi

echo "==> Clearing any stale git index lock..."
rm -f .git/index.lock

echo "==> Fetching latest origin..."
git fetch origin

# Sanity: upstream head
UPSTREAM=$(git rev-parse origin/main)
echo "    origin/main = $UPSTREAM"

# Save current HEAD as a safety branch
HEAD_SHA=$(git rev-parse HEAD)
git branch -f backup/pre-merge-$(date +%Y%m%d-%H%M%S) "$HEAD_SHA"
echo "    backup branch created at $HEAD_SHA"

echo "==> Removing scratch / untracked noise..."
rm -f server/_smoke.js
# Kill any stray vite timestamp configs (already gitignored by new .gitignore)
rm -f vite.config.js.timestamp-*.mjs

echo "==> Untracking sqlite binary files (now in .gitignore)..."
git rm --cached -f server/data/odpulse.sqlite server/data/odpulse.sqlite-shm server/data/odpulse.sqlite-wal 2>/dev/null || true

echo "==> Staging everything..."
git add -A

echo "==> Writing tree + creating merge commit with two parents..."
TREE=$(git write-tree)
MERGE_SHA=$(git commit-tree "$TREE" \
  -p "$HEAD_SHA" \
  -p "$UPSTREAM" \
  -m "Merge origin/main: SQLite pool endpoints + center panel integrated with drilldown drawer and new analytics tabs

Local work integrated:
- Drilldown drawer with summary / customer list / trend chart / receipts history
- Branch Performance & Product Performance tabs (scorecard + branch×product heatmap)
- Every KPI tile and row clickable across all 7 tabs, opens the drilldown drawer
- Backend: /api/od/analytics/{branch-scorecard,product-scorecard,collections-by-product,branch-product-matrix} + /api/od/drilldown with npaOnly/deathOnly/nonContact/mode/minInstallmentsDue filters
- Mode Mix pie chart: removed overlapping per-slice labels, rely on legend
- dev:all npm script (concurrently) to run web+api together
- Improved backend-unreachable error message on OD Upload

Integrated from origin/main:
- SQLite-backed pool endpoints and Group OD center panel with live arrear tracking
- UTF-8 BOM in CSV export (hoisted to module-level downloadCSV for Tamil/Excel)
- Updated .gitignore to exclude sqlite / vite timestamp / runtime data files
- scripts/untrack-sensitive.sh")

echo "    merge commit = $MERGE_SHA"

echo "==> Moving main to the merge commit..."
git update-ref refs/heads/main "$MERGE_SHA"

echo ""
echo "==> Verifying..."
git log --oneline --graph --decorate -5
echo ""
git status
echo ""
echo "==> If everything looks right, push with:"
echo "       git push origin main"
echo ""
echo "    If you want to roll back instead:"
echo "       git reset --hard backup/pre-merge-<timestamp>"
echo "       (use   git branch | grep backup   to see the exact name)"
