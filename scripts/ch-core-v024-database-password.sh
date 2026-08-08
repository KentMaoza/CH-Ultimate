#!/bin/sh
set -eu

random_hex=$(openssl rand -hex 24)
[ "${#random_hex}" -eq 48 ] || {
  printf '%s\n' 'Could not generate a safe database password.' >&2
  exit 1
}
case "$random_hex" in
  *[!0-9a-f]*)
    printf '%s\n' 'Could not generate a safe database password.' >&2
    exit 1
    ;;
esac

printf 'Aa!%s\n' "$random_hex"
