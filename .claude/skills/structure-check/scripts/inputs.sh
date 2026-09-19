# Sourced by check.sh, audit.sh and run.sh: a bad value would reach find as an
# expression, escape the evidence folder, or fail a numeric test and pass a folder as ok.
require_inputs() {
  case "$1" in -*|/*|*..*) echo "root must be a relative directory inside the repository: $1" >&2; exit 2;; esac
  [ -d "$1" ] || { echo "root is not a directory: $1" >&2; exit 2; }
  case "$2" in ''|*[!0-9]*) echo "LIMIT must be a non-negative integer: $2" >&2; exit 2;; esac
  case "$3" in ''|*[!0-9]*) echo "STEMS must be a non-negative integer: $3" >&2; exit 2;; esac
  case "${4:-}" in *[!A-Za-z0-9_-]*) echo "label must use only letters, digits, - and _: ${4:-}" >&2; exit 2;; esac
}
