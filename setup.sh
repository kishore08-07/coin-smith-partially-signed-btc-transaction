#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# setup.sh — Install dependencies for Coin Smith (PSBT transaction builder)
###############################################################################

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Install Node.js dependencies
if [[ -f "package.json" ]]; then
  echo "Installing Node.js dependencies..."
  npm install --no-audit --no-fund 2>&1 | tail -1
fi

# Compile TypeScript
if [[ -f "tsconfig.json" ]]; then
  echo "Compiling TypeScript..."
  npx tsc 2>&1 | tail -5 || true
fi

echo "Setup complete"
