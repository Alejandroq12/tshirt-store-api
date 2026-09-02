#!/usr/bin/env bash
# Status line: model, branch, working-tree state, and contract progress.
#
# Claude Code renders this on every turn, so it has to stay cheap. The
# contract count is not computed here — the SessionStart hook leaves it in the
# system temp directory and this only reads it. Everything else is one git call.
#
# The hook payload arrives as JSON on stdin.

set -uo pipefail

payload=$(cat)

model=$(printf '%s' "$payload" | sed -n 's/.*"display_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
[ -z "$model" ] && model="claude"

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "no-git")

if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  tree="±"
else
  tree="✓"
fi

progress_file="${TMPDIR:-/tmp}/claude-tshirt-progress"
if [ -r "$progress_file" ]; then
  progress=" · ops $(cat "$progress_file")"
else
  progress=""
fi

printf '%s · %s %s%s' "$model" "$branch" "$tree" "$progress"
