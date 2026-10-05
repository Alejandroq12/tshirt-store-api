#!/usr/bin/env bash
# Runs the structure rule, the audit's proposal check and the project gate,
# each whether or not the one before it passed, and exits 0 only when all did.
#
#   ./run.sh                    # print the report
#   ./run.sh after              # also write docs/ai-module/evidence/structure-check-after.txt
#   LIMIT=8 STEMS=2 ROOT=test ./run.sh
#   AUDIT=docs/ai-module/evidence/structure-audit-v2.md ./run.sh
set -u
cd "$(git rev-parse --show-toplevel)"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$here/inputs.sh"
label="${1:-}"
root=$(normalize_root "${ROOT:-src}") || exit 2
limit="${LIMIT:-10}"
stems_limit="${STEMS:-3}"
audit="${AUDIT:-docs/ai-module/evidence/structure-audit-before.md}"
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

say '== proposal: %s ==\n' "$audit"
"$here/proposal.sh" "$audit" 2>&1 | tee -a "$report"
proposal="${PIPESTATUS[0]}"
say 'exit: %d\n\n' "$proposal"

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
say 'rule      exit: %d\n' "$rule"
say 'proposal  exit: %d\n' "$proposal"
say 'gate      exit: %d%s\n' "$gate_exit" "${failed:+ ($failed)}"
red=""
[ "$rule" -eq 0 ] || red="$red; rule: folders marked OVER"
[ "$proposal" -eq 0 ] || red="$red; proposal: unrecorded deviations, missing files, or no usable report"
[ "$gate_exit" -eq 0 ] || red="$red; gate: $failed failed"
if [ -z "$red" ]; then
  say 'PASS  rule, proposal and gate all green\n'
  status=0
else
  say 'FAIL  %s\n' "${red#; }"
  status=1
fi

if [ -n "$label" ]; then
  out="docs/ai-module/evidence/structure-check-$label.txt"
  mkdir -p "$(dirname "$out")"
  cp "$report" "$out"
  printf 'written: %s\n' "$out"
fi
exit "$status"
