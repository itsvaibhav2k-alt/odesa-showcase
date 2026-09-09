#!/usr/bin/env bash
set -euo pipefail

SESSION="${1:-}"
LINES="${2:-120}"

if [[ -z "$SESSION" ]]; then
  echo "Usage: scripts/agents/tmux-capture.sh <session> [lines]" >&2
  exit 2
fi

tmux capture-pane -t "$SESSION" -p -S "-$LINES"
