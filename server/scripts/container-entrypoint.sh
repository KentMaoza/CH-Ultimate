#!/bin/sh
set -eu

die() {
  printf '%s\n' "$1" >&2
  exit 1
}

expected_uid=${CH_CORE_RUNTIME_UID:-}
expected_gid=${CH_CORE_RUNTIME_GID:-}

case "$expected_uid" in
  ''|0|*[!0-9]*) die 'CH_CORE_RUNTIME_UID must be a nonzero numeric value.' ;;
esac
case "$expected_gid" in
  ''|0|*[!0-9]*) die 'CH_CORE_RUNTIME_GID must be a nonzero numeric value.' ;;
esac

actual_uid=$(id -u)
actual_gid=$(id -g)
[ "$actual_uid" = "$expected_uid" ] ||
  die 'Container UID does not match CH_CORE_RUNTIME_UID.'
[ "$actual_gid" = "$expected_gid" ] ||
  die 'Container GID does not match CH_CORE_RUNTIME_GID.'

exec "$@"
