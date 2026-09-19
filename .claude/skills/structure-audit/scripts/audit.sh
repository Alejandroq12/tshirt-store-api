#!/usr/bin/env bash
# For every folder the structure check does not mark ok, groups its files by
# name stem, counts the lines outside it whose quoted path resolves into it,
# and orders the folders safest first: fewest crossings. Read-only.
#
#   ./audit.sh                      # src, limit 10 files, 3 stems
#   LIMIT=8 STEMS=2 ./audit.sh test
#   SHOW=1 ./audit.sh               # also print the lines behind each count
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
check="$here/../../structure-check/scripts/check.sh"
root="${1:-src}"
limit="${LIMIT:-10}"
stems_limit="${STEMS:-3}"
case "$root" in -*|/*|*..*) echo "root must be a relative directory inside the repository: $root" >&2; exit 2;; esac
[ -d "$root" ] || { echo "root is not a directory: $root" >&2; exit 2; }
order=""

refs=$(grep -rnoE "['\"](\.\.?/[^'\"]*|src/[^'\"]*)['\"]" src test --include='*.ts' || true)

# Paths resolve against the file that holds them, so a parent's ./sub/x counts for sub/.
crossings() {
  printf '%s\n' "$refs" | awk -v dir="$1" -v show="${SHOW:-}" '
    function resolve(base, rel,    full, parts, n, i, top, stack, out) {
      full = (rel ~ /^src\//) ? rel : base "/" rel
      n = split(full, parts, "/"); top = 0
      for (i = 1; i <= n; i++) {
        if (parts[i] == "" || parts[i] == ".") continue
        if (parts[i] == "..") { if (top > 0) top--; continue }
        stack[++top] = parts[i]
      }
      out = ""
      for (i = 1; i <= top; i++) out = out (i > 1 ? "/" : "") stack[i]
      return out
    }
    $0 == "" { next }
    {
      i = index($0, ":"); file = substr($0, 1, i - 1); rest = substr($0, i + 1)
      j = index(rest, ":"); path = substr(rest, j + 1); path = substr(path, 2, length(path) - 2)
      base = file; sub(/\/[^\/]*$/, "", base)
      if (index(file, dir "/") == 1) next
      res = resolve(base, path)
      if (res != dir && index(res, dir "/") != 1) next
      n++
      if (show) print "    " $0
    }
    END { if (!show) print n + 0 }'
}

note=""
if [ -n "$(git status --porcelain)" ]; then note=" (uncommitted changes)"; fi
printf 'structure-audit — %s @ %s%s — %s\n' "$(git rev-parse --abbrev-ref HEAD)" "$(git rev-parse --short HEAD)" "$note" "$(date '+%Y-%m-%d %H:%M %Z')"

marked=$(LIMIT="$limit" STEMS="$stems_limit" "$check" "$root" | awk '$3 == "files" && $5 == "stems" && $1 != "ok" { print $1, $2, $4, $6 }' || true)

while read -r mark files stems dir; do
  [ -n "$dir" ] || continue
  count=$(SHOW= crossings "$dir")
  printf '\n== %s — %s: %d files across %d stems (limit %d files, %d stems) ==\n' "$dir" "$mark" "$files" "$stems" "$limit" "$stems_limit"
  find "$dir" -maxdepth 1 -type f -exec basename {} \; | sort \
    | awk -F. '{ stems[$1] = stems[$1] "  " $0 }
               END { for (s in stems) printf "  %-22s%s\n", s, stems[s] }' \
    | sort
  printf '  crossings: %d lines outside the folder resolve to a path inside it\n' "$count"
  [ -z "${SHOW:-}" ] || crossings "$dir"
  order="$order$count $dir $mark"$'\n'
done <<< "$marked"

if [ -z "$order" ]; then
  echo "every folder under $root is ok (limit $limit files, $stems_limit stems)"
else
  printf '\n== order, safest first: fewest crossings ==\n'
  printf '%s' "$order" | sort -n | awk '{ printf "  %4d  %-6s %s\n", $1, $3, $2 }'
fi
