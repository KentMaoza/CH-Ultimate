#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$script_dir/database-common.sh"

[ "$#" -eq 1 ] || die 'Usage: dump-database.sh /absolute/path/dump.sql'
destination=$1
case "$destination" in
  /*) ;;
  *) die 'Dump destination must be an absolute path.' ;;
esac

checksum="${destination}.sha256"
[ ! -e "$destination" ] || die 'Refusing to overwrite an existing dump.'
[ ! -e "$checksum" ] || die 'Refusing to overwrite an existing checksum.'
destination_dir=$(dirname -- "$destination")
[ -d "$destination_dir" ] || die 'Dump destination directory does not exist.'

dump_tmp=$(mktemp "$destination_dir/.ch-core-dump.XXXXXX")
checksum_tmp=$(mktemp "$destination_dir/.ch-core-checksum.XXXXXX")
defaults_tmp=$(mktemp "${TMPDIR:-/tmp}/ch-core-client.XXXXXX")
cleanup() {
  rm -f -- "$dump_tmp" "$checksum_tmp" "$defaults_tmp"
}
trap cleanup EXIT HUP INT TERM

write_client_defaults "$defaults_tmp"
database=$(database_name) || die 'CH_CORE_DATABASE_URL database name is unsafe.'
mariadb-dump \
  --defaults-extra-file="$defaults_tmp" \
  --single-transaction \
  --quick \
  --routines \
  --triggers \
  --events \
  --hex-blob \
  "$database" >"$dump_tmp"

hash=$(sha256_file "$dump_tmp")
printf '%s  %s\n' "$hash" "$(basename -- "$destination")" >"$checksum_tmp"
chmod 600 "$dump_tmp" "$checksum_tmp"
mv -- "$dump_tmp" "$destination"
mv -- "$checksum_tmp" "$checksum"
printf 'Dump and checksum created: %s\n' "$destination"
