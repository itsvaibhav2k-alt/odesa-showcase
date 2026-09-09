#!/usr/bin/env bash
set -euo pipefail

# Minimal authenticated screenshot helper wrapper.
# Prefer task-specific capture scripts when they exist; this wrapper records intent and output dir.
# Usage:
#   scripts/agents/capture-page.sh <route> <output-dir>
#
# For auth-gated pages, write/extend a task-specific Playwright capture script using the Galaxy owner fixture.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

ROUTE="${1:-}"
OUTDIR="${2:-design/agent-capture-$(date +%F-%H%M%S)}"

if [[ -z "$ROUTE" ]]; then
  echo "Usage: scripts/agents/capture-page.sh <route> <output-dir>" >&2
  exit 2
fi

mkdir -p "$OUTDIR"
cat > "$OUTDIR/README.md" <<EOF
# Agent capture request

Route: $ROUTE
Date: $(date -Iseconds)

If this route is auth-gated, use existing e2e Galaxy owner helper patterns or a route-specific capture script. Do not judge UI from the login redirect.
EOF

echo "Prepared capture directory: $OUTDIR"
echo "TODO: use route-specific Playwright/browser capture for $ROUTE"
