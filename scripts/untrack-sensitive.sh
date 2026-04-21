#!/usr/bin/env bash
#
# One-time cleanup: stop tracking sensitive/runtime files in git.
#
# Safe: this only removes files from the git INDEX. Your files on disk
# (including the live SQLite DB on the production server) are NOT deleted.
# After this runs, `git pull` will no longer overwrite these files.
#
# Run from the repo root:
#     bash scripts/untrack-sensitive.sh
#
# Then review with `git status` and commit.

set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Untracking SQLite DB and WAL/SHM files"
git rm --cached --ignore-unmatch \
  server/data/odpulse.sqlite \
  server/data/odpulse.sqlite-shm \
  server/data/odpulse.sqlite-wal

echo "==> Untracking sensitive runtime JSON files"
git rm --cached --ignore-unmatch \
  server/data/users.json \
  server/data/entries.json \
  server/data/notifications.json \
  server/data/config.json

echo "==> Untracking stale xlsx"
git rm --cached --ignore-unmatch failed-entries-to-fix.xlsx || true

echo "==> Untracking stale Vite timestamp cache files"
git rm --cached --ignore-unmatch 'vite.config.js.timestamp-*.mjs' || true

echo ""
echo "Done. Files remain on disk. Review with:"
echo "    git status"
echo ""
echo "Then commit:"
echo "    git add .gitignore"
echo "    git commit -m 'chore: stop tracking runtime data + sensitive files'"
echo ""
echo "NOTE: Sensitive data still exists in git history (past commits)."
echo "      If you want to purge history too, coordinate with the team"
echo "      and use 'git filter-repo' — requires force-push + every dev re-clones."
