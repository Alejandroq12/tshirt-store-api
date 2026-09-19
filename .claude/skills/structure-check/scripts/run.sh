#!/usr/bin/env bash
# Runs the structure rule, then the project gate whether or not the rule
# passed, and exits 0 only when both did.
#
#   ./run.sh                    # print the report
#   ./run.sh after              # also write docs/ai-module/evidence/structure-check-after.txt
#   LIMIT=8 STEMS=2 ROOT=test ./run.sh
set -u
cd "$(git rev-parse --show-toplevel)"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$here/inputs.sh"
label="${1:-}"
root="${ROOT:-src}"
limit="${LIMIT:-10}"
stems_limit="${STEMS:-3}"
require_inputs "$root" "$limit" "$stems_limit" "$label"
gate=(typecheck lint build test:ci)

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
report="$work/report.txt"

say() {
  local fmt="$1"
  shift
  printf -- "$fmt" "$@" | tee -a "$report"
}

dirty=""
if [ -n "$(git status --porcelain)" ]; then dirty=" (uncommitted changes)"; fi
say 'structure-check%s — %s\n' "${label:+ — label: $label}" "$(date '+%Y-%m-%d %H:%M %Z')"
say 'branch: %s @ %s%s\n\n' "$(git rev-parse --abbrev-ref HEAD)" "$(git rev-parse --short HEAD)" "$dirty"

say '== rule: %s %s (limit %s files, %s stems) ==\n' "${here#"$PWD"/}/check.sh" "$root" "$limit" "$stems_limit"
LIMIT="$limit" STEMS="$stems_limit" "$here/check.sh" "$root" 2>&1 | tee -a "$report"
rule="${PIPESTATUS[0]}"
say 'exit: %d\n\n' "$rule"

# A failing command ends the gate: a type error would only make the later steps noise.
say '== gate ==\n'
gate_exit=0
failed=""
for cmd in "${gate[@]}"; do
  if [ -n "$failed" ]; then
    say 'npm run %-10s skipped   %s failed first\n' "$cmd" "$failed"
    continue
  fi
  log="$work/$cmd.log"
  npm run --silent "$cmd" >"$log" 2>&1
  code=$?
  if [ "$code" -eq 0 ]; then
    if [ "$cmd" = test:ci ]; then
      suites="$(grep -E '^Test Suites:' "$log")"
      tests="$(grep -E '^Tests:' "$log")"
      say 'npm run %-10s exit: 0   %s\n' "$cmd" "${suites:-clean}"
      [ -n "$tests" ] && say '%29s%s\n' '' "$tests"
    else
      say 'npm run %-10s exit: 0   clean\n' "$cmd"
    fi
  else
    gate_exit="$code"
    failed="$cmd"
    say 'npm run %-10s exit: %d   failed; last lines of its output:\n' "$cmd" "$code"
    tail -n 15 "$log" | sed 's/^/    /' | tee -a "$report"
  fi
done
say '\n'

say '== verdict ==\n'
say 'rule  exit: %d\n' "$rule"
say 'gate  exit: %d%s\n' "$gate_exit" "${failed:+ ($failed)}"
if [ "$rule" -eq 0 ] && [ "$gate_exit" -eq 0 ]; then
  say 'PASS  rule and gate both green\n'
  status=0
elif [ "$rule" -ne 0 ] && [ "$gate_exit" -ne 0 ]; then
  say 'FAIL  folders marked OVER, and the gate failed at %s\n' "$failed"
  status=1
elif [ "$rule" -ne 0 ]; then
  say 'FAIL  folders marked OVER; the gate is green, so the tree compiles and its tests pass as it stands\n'
  status=1
else
  say 'FAIL  the gate failed at %s; the structure rule holds\n' "$failed"
  status=1
fi

if [ -n "$label" ]; then
  out="docs/ai-module/evidence/structure-check-$label.txt"
  mkdir -p "$(dirname "$out")"
  cp "$report" "$out"
  printf 'written: %s\n' "$out"
fi
exit "$status"
