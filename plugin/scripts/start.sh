#!/usr/bin/env bash
# Spawned by Claude Code over stdio. stdout is the JSON-RPC stream, so every
# install message is pushed to stderr.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -d node_modules/playwright-core ] || [ ! -d node_modules/@modelcontextprotocol ]; then
  if [ -f package-lock.json ]; then
    npm ci --silent --no-audit --no-fund --no-progress 1>&2
  else
    npm install --silent --no-audit --no-fund --no-progress 1>&2
  fi
fi
exec node server/index.mjs
