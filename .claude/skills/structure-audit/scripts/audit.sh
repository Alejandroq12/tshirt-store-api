#!/usr/bin/env bash
# For every folder over the limit, show its files grouped by name stem so the
# responsibilities mixed inside it are visible at a glance. Read-only.
#
#   ./audit.sh            # src, limit 10
#   LIMIT=8 ./audit.sh test
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

root="${1:-src}"
limit="${LIMIT:-10}"
found=0

for dir in $(find "$root" -type d | sort); do
  count=$(find "$dir" -maxdepth 1 -type f | wc -l | tr -d ' ')
  [ "$count" -gt "$limit" ] || continue
  found=1
  printf '\n== %s — %d files, limit %d ==\n' "$dir" "$count" "$limit"
  find "$dir" -maxdepth 1 -type f -exec basename {} \; | sort \
    | awk -F. '{ stems[$1] = stems[$1] "  " $0 }
               END { for (s in stems) printf "  %-22s%s\n", s, stems[s] }' \
    | sort
done

[ "$found" -eq 1 ] || echo "no folder under $root holds more than $limit files"
