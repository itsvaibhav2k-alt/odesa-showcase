#!/usr/bin/env bash
set -euo pipefail

# Launch Claude Code in a tmux session with an Odesa handoff prompt.
# Usage:
#   scripts/agents/launch-claude-handoff.sh <handoff-path> [session-name]
#
# The session is interactive so Hermes can monitor/steer it with tmux capture/send-keys.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

HANDOFF="${1:-}"
SESSION="${2:-odesa-claude-$(date +%Y%m%d-%H%M%S)}"

if [[ -z "$HANDOFF" ]]; then
  echo "Usage: scripts/agents/launch-claude-handoff.sh <handoff-path> [session-name]" >&2
  exit 2
fi

if [[ ! -f "$HANDOFF" ]]; then
  echo "Handoff not found: $HANDOFF" >&2
  exit 2
fi

PROMPT="/goal Read and execute the Obsidian handoff at @$HANDOFF

Use the repo rules in AGENTS.md and docs/AGENT_REPO_MAP.md. No commit/push/deploy. Return exact files changed, gates, screenshots/artifacts, blockers vs polish, and whether anything is deferred."

if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "tmux session already exists: $SESSION" >&2
  exit 2
fi

tmux new-session -d -s "$SESSION" -x 140 -y 48 "cd '$ROOT' && claude"
sleep 4
tmux send-keys -t "$SESSION" "$PROMPT" Enter

echo "Started Claude session: $SESSION"
echo "Capture: scripts/agents/tmux-capture.sh $SESSION"
echo "Attach:  tmux attach -t $SESSION"
