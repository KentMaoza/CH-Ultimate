#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$script_dir/database-common.sh"

[ "$#" -eq 0 ] || die 'Usage: compare-scratch.sh'

umask 077
source_defaults=$(mktemp "${TMPDIR:-/tmp}/ch-core-source-client.XXXXXX")
scratch_defaults=$(mktemp "${TMPDIR:-/tmp}/ch-core-scratch-client.XXXXXX")
source_dump=$(mktemp "${TMPDIR:-/tmp}/ch-core-source-dump.XXXXXX")
scratch_dump=$(mktemp "${TMPDIR:-/tmp}/ch-core-scratch-dump.XXXXXX")
cleanup() {
  rm -f -- \
    "$source_defaults" \
    "$scratch_defaults" \
    "$source_dump" \
    "$scratch_dump"
}
trap cleanup EXIT HUP INT TERM

write_client_defaults "$source_defaults" CH_CORE_BACKUP_DATABASE_URL
write_client_defaults "$scratch_defaults" CH_CORE_RESTORE_DATABASE_URL
source_database=$(database_name CH_CORE_BACKUP_DATABASE_URL backup)
scratch_database=$(database_name CH_CORE_RESTORE_DATABASE_URL restore)
[ "$source_database" != "$scratch_database" ] ||
  die 'Source and scratch databases must be different.'
dump_binary=$(database_binary CH_CORE_MARIADB_DUMP_BIN mariadb-dump)

canonical_dump() {
  defaults=$1
  database=$2
  destination=$3
  "$dump_binary" \
    --defaults-extra-file="$defaults" \
    --single-transaction \
    --quick \
    --routines \
    --triggers \
    --events \
    --hex-blob \
    --skip-comments \
    --skip-dump-date \
    --skip-add-locks \
    --skip-lock-tables \
    --skip-disable-keys \
    "$database" >"$destination"
  chmod 600 "$destination"
}

canonical_dump "$source_defaults" "$source_database" "$source_dump"
canonical_dump "$scratch_defaults" "$scratch_database" "$scratch_dump"

source_hash=$(sha256_file "$source_dump")
scratch_hash=$(sha256_file "$scratch_dump")
if [ "$source_hash" != "$scratch_hash" ] ||
  ! cmp -s "$source_dump" "$scratch_dump"; then
  die 'Restored scratch canonical dump does not match the source database.'
fi

printf 'CH_CORE_SCRATCH_COMPARE_V1\n'
printf 'SOURCE_DATABASE=%s\n' "$source_database"
printf 'SCRATCH_DATABASE=%s\n' "$scratch_database"
printf 'CANONICAL_SHA256=%s\n' "$source_hash"
printf 'MATCH=YES\n'
