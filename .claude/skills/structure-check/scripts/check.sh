#!/usr/bin/env bash
# Fails when a folder under the root is over the file limit across more than
# the stem limit, the stem being the file name up to the first dot. Over the
# file limit with few stems is big; many stems under it is mixed; both pass.
#
#   ./check.sh                      # src, limit 10 files, 3 stems
#   LIMIT=8 STEMS=2 ./check.sh test
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

root="${1:-src}"
limit="${LIMIT:-10}"
stems_limit="${STEMS:-3}"
case "$root" in -*|/*|*..*) echo "root must be a relative directory inside the repository: $root" >&2; exit 2;; esac
[ -d "$root" ] || { echo "root is not a directory: $root" >&2; exit 2; }
status=0

for dir in $(find "$root" -type d | sort); do
  files=$(find "$dir" -maxdepth 1 -type f | wc -l | tr -d ' ')
  stems=$(find "$dir" -maxdepth 1 -type f -exec basename {} \; | sed 's/\..*//' | sort -u | wc -l | tr -d ' ')
  if [ "$files" -gt "$limit" ] && [ "$stems" -gt "$stems_limit" ]; then
    mark=OVER
    status=1
  elif [ "$files" -gt "$limit" ]; then
    mark=big
  elif [ "$stems" -gt "$stems_limit" ]; then
    mark=mixed
  else
    mark=ok
  fi
  printf '%-5s %3d files %2d stems  %s\n' "$mark" "$files" "$stems" "$dir"
done

if [ "$status" -eq 0 ]; then
  echo "structure: no folder under $root holds more than $limit files across more than $stems_limit stems"
else
  echo "structure: folders marked OVER must be grouped by responsibility (limit $limit files, $stems_limit stems)"
fi
exit "$status"
