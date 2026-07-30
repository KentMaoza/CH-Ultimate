#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$script_dir/database-common.sh"

[ "$#" -eq 1 ] || die 'Usage: verify-dump.sh /absolute/path/dump.sql'
dump=$1
case "$dump" in
  /*) ;;
  *) die 'Dump path must be absolute.' ;;
esac
[ -f "$dump" ] && [ ! -L "$dump" ] || die 'Dump must be a regular non-symlink file.'
checksum="${dump}.sha256"
[ -f "$checksum" ] && [ ! -L "$checksum" ] || die 'Checksum sidecar is missing or unsafe.'

expected=$(awk 'NR == 1 && NF == 2 { print $1 }' "$checksum")
[ "${#expected}" -eq 64 ] || die 'Checksum sidecar is invalid.'
actual=$(sha256_file "$dump")
[ "$actual" = "$expected" ] || die 'Dump checksum does not match.'
printf 'Checksum verified: %s\n' "$dump"
