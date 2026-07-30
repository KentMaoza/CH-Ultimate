#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$script_dir/database-common.sh"

[ "$#" -eq 2 ] || die 'Usage: restore-scratch.sh /absolute/path/dump.sql chu_restore_NAME'
dump=$1
scratch=$2
case "$scratch" in
  chu_restore_*) ;;
  *) die 'Scratch database must match chu_restore_NAME and may never be a production name.' ;;
esac
case "$scratch" in
  chu_restore_|*[!a-z0-9_]*)
    die 'Scratch database must match chu_restore_NAME and may never be a production name.'
    ;;
esac

"$script_dir/verify-dump.sh" "$dump"
defaults_tmp=$(mktemp "${TMPDIR:-/tmp}/ch-core-client.XXXXXX")
cleanup() {
  rm -f -- "$defaults_tmp"
}
trap cleanup EXIT HUP INT TERM
write_client_defaults "$defaults_tmp"

existing=$(mariadb --defaults-extra-file="$defaults_tmp" --batch --skip-column-names \
  --execute="SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = '$scratch'")
[ -z "$existing" ] || die 'Scratch database already exists; refusing to overwrite it.'
mariadb --defaults-extra-file="$defaults_tmp" \
  --execute="CREATE DATABASE \`$scratch\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
mariadb --defaults-extra-file="$defaults_tmp" "$scratch" <"$dump"
printf 'Scratch restore completed without changing the source schema: %s\n' "$scratch"
