#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$script_dir/database-common.sh"

[ "$#" -eq 1 ] ||
  die 'Usage: verify-dump.sh /absolute/completed-backup.bundle'
bundle=$1
require_backup_bundle_path "$bundle" /backup
[ -d "$bundle" ] && [ ! -L "$bundle" ] ||
  die 'Backup bundle must be a regular non-symlink directory.'

dump_path=$bundle/dump.sql
checksum_path=$bundle/dump.sql.sha256
marker_path=$bundle/COMPLETE

entry_count=$(find "$bundle" -mindepth 1 -maxdepth 1 -print | wc -l | tr -d ' ')
[ "$entry_count" = '3' ] ||
  die 'Backup bundle contains unexpected or incomplete entries.'
for required_path in "$dump_path" "$checksum_path" "$marker_path"; do
  [ -f "$required_path" ] && [ ! -L "$required_path" ] ||
    die 'Backup bundle entries must be regular non-symlink files.'
done

marker=$(cat "$marker_path")
[ "$marker" = 'CH_CORE_BACKUP_COMPLETE_V1' ] ||
  die 'Backup bundle completion marker is missing or invalid.'

checksum_lines=$(wc -l <"$checksum_path" | tr -d ' ')
[ "$checksum_lines" = '1' ] || die 'Backup checksum sidecar is invalid.'
expected=$(awk 'NR == 1 && NF == 2 && $2 == "dump.sql" { print $1 }' "$checksum_path")
case "$expected" in
  ????????????????????????????????????????????????????????????????) ;;
  *) die 'Backup checksum sidecar is invalid.' ;;
esac
case "$expected" in
  *[!0-9a-fA-F]*) die 'Backup checksum sidecar is invalid.' ;;
esac

actual=$(sha256_file "$dump_path")
[ "$actual" = "$expected" ] || die 'Backup dump checksum does not match.'
printf 'Completed backup bundle verified: %s\n' "$bundle"
