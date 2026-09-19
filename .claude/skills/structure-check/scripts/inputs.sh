# Sourced by check.sh, audit.sh and run.sh: a bad value would reach find as an
# expression, escape the evidence folder, or fail a numeric test and pass a folder as ok.
# One spelling per root, since the scripts compare paths: empty and . segments go,
# so ./src, src/, src/. and src//auth become src and src/auth; .., absolute and dashed roots are refused.
normalize_root() {
  local in="$1" out="" seg
  case "$in" in /*) echo "root must be a relative directory inside the repository: $in" >&2; return 2;; esac
  while [ -n "$in" ]; do
    seg="${in%%/*}"
    if [ "$seg" = "$in" ]; then in=""; else in="${in#*/}"; fi
    case "$seg" in ''|.) continue;; ..) echo "root must be a relative directory inside the repository: $1" >&2; return 2;; esac
    out="${out:+$out/}$seg"
  done
  case "$out" in '') echo "root is not a directory: $1" >&2; return 2;; -*) echo "root must be a relative directory inside the repository: $1" >&2; return 2;; esac
  printf '%s\n' "$out"
}
require_inputs() {
  [ -d "$1" ] || { echo "root is not a directory: $1" >&2; exit 2; }
  case "$2" in ''|*[!0-9]*) echo "LIMIT must be a non-negative integer: $2" >&2; exit 2;; esac
  case "$3" in ''|*[!0-9]*) echo "STEMS must be a non-negative integer: $3" >&2; exit 2;; esac
  case "${4:-}" in *[!A-Za-z0-9_-]*) echo "label must use only letters, digits, - and _: ${4:-}" >&2; exit 2;; esac
}
