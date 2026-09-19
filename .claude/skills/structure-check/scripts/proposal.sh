#!/usr/bin/env bash
# Every path in the report's proposal block exists, or its deviation is recorded
# as "proposed -> actual: reason"; anything else fails, as do a missing report,
# a missing block and a malformed line.
#
#   ./proposal.sh                                        # docs/ai-module/evidence/structure-audit-before.md
#   ./proposal.sh docs/ai-module/evidence/structure-audit-v2.md
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

report="${1:-docs/ai-module/evidence/structure-audit-before.md}"
[ -f "$report" ] || { echo "no audit report at $report" >&2; exit 2; }

# Scans the whole report. Exit 1 when the block is absent, 2 when a closing fence is, 3 when it appears twice.
block() { awk -v name="$1" '!on && $0 == "```" name { on = 1; count++; next } on && $0 == "```" { on = 0; next } on { print } END { if (!count) exit 1; if (count > 1) exit 3; if (on) exit 2 }' "$report"; }
proposed=$(block proposal) || case $? in
  1) echo "no proposal block in $report" >&2; exit 2;;
  2) echo "unterminated proposal block in $report" >&2; exit 2;;
  *) echo "more than one proposal block in $report" >&2; exit 2;;
esac
deviations=$(block deviations) || case $? in
  1) deviations="";;
  2) echo "unterminated deviations block in $report" >&2; exit 2;;
  *) echo "more than one deviations block in $report" >&2; exit 2;;
esac

malformed() { echo "malformed $1 in $report: $2" >&2; exit 2; }
# Repository-relative and normalized: no leading slash, no . or .. segment, no empty segment.
valid_path() { [ -n "$1" ] && case "/$1/" in //*|*/./*|*/../*|*//*) false;; esac; }
# A path that ends in / names a directory, any other a file.
exists() { if [[ "$1" == */ ]]; then [ -d "${1%/}" ]; else [ -f "$1" ]; fi; }

n=0
while IFS= read -r line; do
  [ -n "$line" ] || continue
  from="${line%% -> *}"; rest="${line#* -> }"; to="${rest%%: *}"; why="${rest#*: }"
  [ "$from" != "$line" ] && [ "$to" != "$rest" ] || malformed deviation "$line"
  [[ "$why" =~ [^[:space:]] ]] || malformed deviation "$line"
  valid_path "${from%/}" && valid_path "${to%/}" || malformed deviation "$line"
  { [[ "$from" == */ ]] && [[ "$to" == */ ]]; } || { [[ "$from" != */ ]] && [[ "$to" != */ ]]; } || malformed deviation "$line"
  [ "${from%%/*}" = "${to%%/*}" ] || malformed "deviation, which must stay under one top-level folder," "$line"
  dev_from[n]="$from"; dev_to[n]="$to"; dev_why[n]="$why"; n=$((n + 1))
done <<< "$deviations"

kept=0; recorded=0; unrecorded=0; missing=0
while IFS= read -r path; do
  [ -n "$path" ] || continue
  valid_path "${path%/}" || malformed "proposed path" "$path"
  if exists "$path"; then
    printf 'kept        %s\n' "$path"; kept=$((kept + 1)); continue
  fi
  # The longest folder prefix wins; a file is mapped only by its exact path.
  best=-1; actual=""; why=""
  for ((i = 0; i < n; i++)); do
    from="${dev_from[i]}"
    if [[ "$from" == */ ]]; then [[ "$path" == "$from"* ]] || continue; else [ "$path" = "$from" ] || continue; fi
    if [ "${#from}" -gt "$best" ]; then best="${#from}"; actual="${dev_to[i]}${path#"$from"}"; why="${dev_why[i]}"; fi
  done
  if [ "$best" -ge 0 ] && exists "$actual"; then
    printf 'recorded    %s -> %s: %s\n' "$path" "$actual" "$why"; recorded=$((recorded + 1)); continue
  fi
  name="${path%/}"; name="${name##*/}"; kind=f; [[ "$path" == */ ]] && kind=d
  IFS=/ read -r top second _ <<< "$path"
  found=$(find "$top/$second" -type "$kind" -name "$name" 2>/dev/null | sort | awk 'NR == 1' || true)
  if [ -n "$found" ]; then
    printf 'UNRECORDED  %s is at %s\n' "$path" "$found"; unrecorded=$((unrecorded + 1))
  else
    printf 'MISSING     %s\n' "$path"; missing=$((missing + 1))
  fi
done <<< "$proposed"

printf 'proposal: %d kept, %d recorded deviations, %d unrecorded, %d missing\n' "$kept" "$recorded" "$unrecorded" "$missing"
[ "$((unrecorded + missing))" -eq 0 ] || exit 1
