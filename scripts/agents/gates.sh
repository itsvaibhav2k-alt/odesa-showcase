#!/usr/bin/env bash
set -euo pipefail

# Odesa common verification runner.
# Usage:
#   scripts/agents/gates.sh                 # typecheck + lint + build
#   scripts/agents/gates.sh financials       # financials unit + e2e
#   scripts/agents/gates.sh retell           # retell e2e
#   scripts/agents/gates.sh quick            # typecheck + lint

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

MODE="${1:-full}"
BASE_URL="${BASE_URL:-http://localhost:3100}"

run() {
  echo
  echo "==> $*"
  "$@"
}

case "$MODE" in
  quick)
    run npm run typecheck
    run npm run lint
    ;;
  financials)
    run npm run typecheck
    run npm run lint
    run npm test -- src/lib/financials
    run env BASE_URL="$BASE_URL" npx playwright test e2e/financials/console.spec.ts --project=chromium --workers=1
    ;;
  retell|voice)
    run npm run typecheck
    run npm run lint
    run env BASE_URL="$BASE_URL" npx playwright test e2e/retell/tool-endpoints.spec.ts --project=chromium --workers=1
    run npm run build
    ;;
  full)
    run npm run typecheck
    run npm run lint
    run npm run build
    ;;
  *)
    echo "Unknown mode: $MODE" >&2
    echo "Modes: quick | financials | retell | voice | full" >&2
    exit 2
    ;;
esac
