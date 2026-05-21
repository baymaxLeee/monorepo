#!/usr/bin/env bash
# Spawn an isolated git worktree for a parallel agent run.
# Use ONLY when truly running multiple agent processes simultaneously.
# For in-context multi-agent dispatch, this is NOT needed.
set -euo pipefail

TASK_ID="${1:?Usage: worktree.sh <task-id> <subagent>}"
SUBAGENT="${2:?Usage: worktree.sh <task-id> <subagent>}"

WT_DIR=".worktrees/${TASK_ID}-${SUBAGENT}"
BRANCH="agent/${TASK_ID}/${SUBAGENT}"

if [ -d "$WT_DIR" ]; then
  echo "Worktree exists: $WT_DIR"
  exit 0
fi

git worktree add -b "$BRANCH" "$WT_DIR" HEAD
echo "✓ Created: $WT_DIR (branch: $BRANCH)"
echo "  Enter with: cd $WT_DIR"
echo "  Remove with: git worktree remove $WT_DIR && git branch -D $BRANCH"
