#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$script_dir/database-common.sh"

[ "$#" -eq 1 ] ||
  die 'Usage: dump-database.sh /absolute/new-backup.bundle'
bundle=$1
require_absolute_path "$bundle" 'Backup bundle path'

bundle_parent=$(dirname -- "$bundle")
[ -d "$bundle_parent" ] && [ ! -L "$bundle_parent" ] ||
  die 'Backup bundle parent must be a regular directory.'

umask 077
mkdir -- "$bundle" 2>/dev/null ||
  die 'Backup bundle already exists or could not be reserved.'
chmod 700 "$bundle"

dump_path=$bundle/dump.sql
checksum_path=$bundle/dump.sql.sha256
marker_path=$bundle/COMPLETE
defaults_tmp=$(mktemp "${TMPDIR:-/tmp}/ch-core-client.XXXXXX")
cleanup() {
  rm -f -- "$defaults_tmp"
}
trap cleanup EXIT HUP INT TERM

write_client_defaults "$defaults_tmp" CH_CORE_BACKUP_DATABASE_URL
database=$(database_name CH_CORE_BACKUP_DATABASE_URL backup)
dump_binary=$(database_binary CH_CORE_MARIADB_DUMP_BIN mariadb-dump)
"$dump_binary" \
  --defaults-extra-file="$defaults_tmp" \
  --single-transaction \
  --quick \
  --routines \
  --triggers \
  --events \
  --hex-blob \
  "$database" >"$dump_path"
chmod 600 "$dump_path"

hash=$(sha256_file "$dump_path")
printf '%s  dump.sql\n' "$hash" >"$checksum_path"
chmod 600 "$checksum_path"

printf 'CH_CORE_BACKUP_COMPLETE_V1\n' >"$marker_path"
chmod 600 "$marker_path"
printf 'Completed backup bundle: %s\n' "$bundle"
