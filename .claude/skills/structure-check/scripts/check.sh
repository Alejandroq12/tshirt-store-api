#!/usr/bin/env bash
# Fails when any folder under the root holds more than the limit directly.
#
#   ./check.sh            # src, limit 10
#   LIMIT=8 ./check.sh test
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

root="${1:-src}"
limit="${LIMIT:-10}"
status=0

for dir in $(find "$root" -type d | sort); do
  count=$(find "$dir" -maxdepth 1 -type f | wc -l | tr -d ' ')
  if [ "$count" -gt "$limit" ]; then
    printf 'OVER  %3d  %s\n' "$count" "$dir"
    status=1
  else
    printf 'ok    %3d  %s\n' "$count" "$dir"
  fi
done

if [ "$status" -eq 0 ]; then
  echo "structure: every folder under $root holds at most $limit files"
else
  echo "structure: folders marked OVER must be grouped by responsibility (limit $limit)"
fi
exit "$status"
