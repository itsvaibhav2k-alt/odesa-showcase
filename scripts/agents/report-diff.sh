#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

echo "== git status --short --branch =="
git status --short --branch

echo
echo "== git diff --stat =="
git diff --stat

echo
echo "== git diff --name-status =="
git diff --name-status

echo
echo "== untracked files =="
git ls-files --others --exclude-standard | sed -n '1,200p'
