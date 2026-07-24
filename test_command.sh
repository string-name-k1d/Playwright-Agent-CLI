#!/bin/bash

set -e

echo "=== pw-cli-agent test suite ==="

cd /workspace/agent

# Build
npm install
npm run build

# test_command.sh — run inside container
# TARGET_URL is loaded from .env via docker-compose

echo ""
echo "--- check (tools only) ---"
node dist/index.js check

echo ""
echo "--- check with --url ---"
node dist/index.js check --url "${TARGET_URL:-https://example.com}"

echo ""
echo "--- check via config fallback (no --url flag) ---"
node dist/index.js check

echo ""
echo "--- explore ---"
node dist/index.js explore --url "${TARGET_URL:-https://example.com}"

echo ""
echo "--- explore via config fallback ---"
node dist/index.js explore

echo ""
echo "--- report ---"
node dist/index.js report

echo ""
echo "--- skill ---"
node dist/index.js skill --output-dir /tmp/pw-cli-skills --agents

echo ""
echo "--- help ---"
node dist/index.js --help

echo ""
echo "=== All tests completed ==="
