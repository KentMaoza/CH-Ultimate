#!/bin/sh
set -eu

[ "$#" -eq 1 ] || {
  printf '%s\n' 'Invalid non-negative integer.' >&2
  exit 1
}
case "$1" in
  ''|*[!0-9]*)
    printf '%s\n' 'Invalid non-negative integer.' >&2
    exit 1
    ;;
esac
