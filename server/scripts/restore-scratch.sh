#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$script_dir/database-common.sh"

[ "$#" -eq 1 ] ||
  die 'Usage: restore-scratch.sh /absolute/completed-backup.bundle'
bundle=$1
require_backup_bundle_path "$bundle" /backup
"$script_dir/verify-dump.sh" "$bundle"

defaults_tmp=$(mktemp "${TMPDIR:-/tmp}/ch-core-client.XXXXXX")
cleanup() {
  rm -f -- "$defaults_tmp"
}
trap cleanup EXIT HUP INT TERM

write_client_defaults "$defaults_tmp" CH_CORE_RESTORE_DATABASE_URL
scratch=$(database_name CH_CORE_RESTORE_DATABASE_URL restore)
mariadb_binary=$(database_binary CH_CORE_MARIADB_BIN mariadb)

schema_count=$(
  "$mariadb_binary" \
    --defaults-extra-file="$defaults_tmp" \
    --batch \
    --skip-column-names \
    --execute="SELECT COUNT(*) FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = '$scratch'"
)
[ "$schema_count" = '1' ] ||
  die 'Scratch schema must already exist and be dedicated to this restore.'

object_count=$(
  "$mariadb_binary" \
    --defaults-extra-file="$defaults_tmp" \
    --batch \
    --skip-column-names \
    --execute="SELECT
      (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = '$scratch') +
      (SELECT COUNT(*) FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_SCHEMA = '$scratch') +
      (SELECT COUNT(*) FROM INFORMATION_SCHEMA.EVENTS WHERE EVENT_SCHEMA = '$scratch') +
      (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TRIGGERS WHERE TRIGGER_SCHEMA = '$scratch')"
)
[ "$object_count" = '0' ] ||
  die 'Scratch schema is not empty. Use reviewed DBA cleanup and create a NEW scratch schema/name.'

grants=$(
  "$mariadb_binary" \
    --defaults-extra-file="$defaults_tmp" \
    --batch \
    --skip-column-names \
    --execute='SHOW GRANTS FOR CURRENT_USER'
)
CH_CORE_ACTIVE_GRANTS=$grants node --input-type=module - "$scratch" <<'NODE'
import process from 'node:process';

const scratch = process.argv[2];
const grants = process.env.CH_CORE_ACTIVE_GRANTS ?? '';
const escaped = scratch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exactSchema = new RegExp(
  String.raw`^GRANT .+ ON (?:\`${escaped}\`|${escaped})\.\* TO `,
  'i',
);
for (const line of grants.split(/\r?\n/).filter(Boolean)) {
  if (/^GRANT USAGE ON \*\.\* TO /i.test(line)) continue;
  if (exactSchema.test(line)) continue;
  process.stderr.write(
    'Restore credentials have global, role, proxy, or other-schema grants.\n',
  );
  process.exit(1);
}
NODE

if ! "$mariadb_binary" \
  --defaults-extra-file="$defaults_tmp" \
  "$scratch" <"$bundle/dump.sql"; then
  die 'Scratch import failed and may be partial. Discard it through reviewed DBA cleanup and create a NEW scratch schema/name; never retry this name.'
fi
printf 'Scratch restore completed in the existing empty schema: %s\n' "$scratch"
