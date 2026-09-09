#!/usr/bin/env bash
set -euo pipefail

# Ask Codex to review the current Odesa diff without editing.
# Usage:
#   scripts/agents/codex-review.sh [extra focus]

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

FOCUS="${*:-current diff}"

PROMPT="You are reviewing an Odesa code diff as an independent safety/product/code reviewer.

Repo: $ROOT
Focus: $FOCUS

Rules:
- Read AGENTS.md and docs/AGENT_REPO_MAP.md first.
- Inspect git status, diff stat, and changed files.
- Do not edit files.
- Do not commit/push/deploy.
- Separate blockers from non-blocking polish.
- Pay special attention to data honesty, fake integrations/routes, unsafe Retell/voice autonomy, UI regressions, tests weakened, and missing verification.
- Return concise findings with exact file/line references when possible, plus a GREEN/YELLOW/RED verdict."

codex exec --cd "$ROOT" --sandbox read-only --ask-for-approval never "$PROMPT"
