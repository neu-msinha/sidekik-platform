#!/usr/bin/env bash
# Integration smoke test (ARCHITECTURE §11). Usage: dev/smoke.sh [health|h6|h14|h18] [options]; see dev/smoke.ts.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
if [[ -x node_modules/.bin/tsx ]]; then exec node_modules/.bin/tsx dev/smoke.ts "$@"; fi
exec npx -y tsx dev/smoke.ts "$@"
