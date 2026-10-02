#!/usr/bin/env bash
# Spawned by Claude Code over stdio. stdout is the JSON-RPC stream, so every
# install message is pushed to stderr.
set -euo pipefail
cd "$(dirname "$0")/.."
# npm writes node_modules/.package-lock.json last, so a half-finished install is retried.
# ponytail: two first-run sessions starting at once race inside the same npm ci; rare, and
# npm's own locking handles the common case.
if [ ! -f node_modules/.package-lock.json ]; then
  if [ -f package-lock.json ]; then
    npm ci --silent --no-audit --no-fund --no-progress 1>&2
  else
    npm install --silent --no-audit --no-fund --no-progress 1>&2
  fi
fi
exec node server/index.mjs
