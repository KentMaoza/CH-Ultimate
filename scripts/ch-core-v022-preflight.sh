#!/bin/sh
set -eu

die() {
  printf '%s\n' "$1" >&2
  exit 1
}

validate_client_gate() {
  client=$1
  state=$2
  outbox=$3
  case "$state:$outbox" in
    INSTALLED:0|UNINSTALLED:UNAVAILABLE_AFTER_OWNER_UNINSTALL) ;;
    *)
      die "$client must be INSTALLED with outbox 0, or UNINSTALLED with outbox UNAVAILABLE_AFTER_OWNER_UNINSTALL."
      ;;
  esac
}

[ "${CH_CORE_PREFLIGHT_APPROVED:-}" = 'YES' ] ||
  die 'Set CH_CORE_PREFLIGHT_APPROVED=YES only after owner approval.'
[ "${CH_CORE_PREFLIGHT_QUIESCED:-}" = 'YES' ] ||
  die 'Set CH_CORE_PREFLIGHT_QUIESCED=YES only after every client is closed or uninstalled.'

windows_state=${CH_CORE_PREFLIGHT_WINDOWS_STATE:-}
windows_outbox=${CH_CORE_PREFLIGHT_WINDOWS_OUTBOX:-}
android_state=${CH_CORE_PREFLIGHT_ANDROID_STATE:-}
android_outbox=${CH_CORE_PREFLIGHT_ANDROID_OUTBOX:-}
validate_client_gate Windows "$windows_state" "$windows_outbox"
validate_client_gate Android "$android_state" "$android_outbox"

project_dir='/volume1/docker/ch-ultimate-4482af7/server'
[ -d "$project_dir" ] && [ ! -L "$project_dir" ] ||
  die 'Exact live project directory is unavailable or unsafe.'
cd "$project_dir"
[ -f compose.yaml ] && [ ! -L compose.yaml ] ||
  die 'Exact live Compose file is unavailable or unsafe.'
command -v docker >/dev/null 2>&1 || die 'Docker is unavailable.'
docker compose version >/dev/null 2>&1 || die 'Docker Compose is unavailable.'

required_tables='
schema_migrations
devices
pairings
owner_recovery
skus
sku_identifiers
price_history
templates
imports
image_assets
image_jobs
notas
nota_pages
nota_lines
nota_postings
nota_daily_sequences
nota_conflicts
revenue_postings
stock_movements
stock_balances
stock_checks
idempotency_receipts
audit_events
client_cursor_acknowledgements
change_log
business_write_lock
'

expected_migrations='1|001_initial.sql|e22cfbbf1af7b72e0091c9bf8a399ac2570fc6f971723330d085d0954cf68b69
2|002_nota_line_page_ownership.sql|39fd3afbe56aef8fa4b5c317753622998f73877925f1eed24996686721f17923
3|003_identity_sync_protocol.sql|cb1ab6f8382317cf9e3abfde5f9f4edf6883eea75f06cc0c6b1d4ac54dbde581
4|004_replay_safe_protocol.sql|e82b21d3e86680432f270b51a1d61c79cd0c69105f9e9ab8212768dcc1387139
5|005_catalogue_import.sql|b36063e077279b11997bed0cb4577053b7ff6f3ff7ef19e2c13d5678163209b0
6|006_business_write_safety.sql|dbe0d11d5dfc3241c985afd2db37ce37cea24231397e62e5e8711ea84403cad
7|007_active_template_kind.sql|b03215e308d94c374cc8e2d63da47599f85cf3338f788baf3add26a47ec1ae44
8|008_nota_authority.sql|a75edec750744aa68b28be3e53b50ea001b7be0c8a50c8ea413a309adeef2cfc
9|009_offline_operations.sql|e4a35e360a8e726dc0cbfa202b9f445b684a39172ce42c8944c3a975dce892c1'

stamp=$(TZ=Asia/Makassar date '+%Y%m%d-%H%M%S')
time_wita=$(TZ=Asia/Makassar date '+%Y-%m-%dT%H:%M:%S%z')
case "$stamp" in
  [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]) ;;
  *) die 'Could not generate a safe WITA timestamp.' ;;
esac

bundle_name="chu-v022-${stamp}.bundle"
bundle_path="/backup/$bundle_name"
receipt_name="chu-v022-${stamp}.preflight.txt"

docker compose --profile ops run --rm ch-core-ops \
  /bin/sh -eu -c '
    . /opt/ch-core-ops/database-common.sh
    receipt_name=$1
    time_wita=$2
    required_tables=$3
    expected_migrations=$4
    windows_state=$5
    windows_outbox=$6
    android_state=$7
    android_outbox=$8
    case "$receipt_name" in
      chu-v022-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9].preflight.txt) ;;
      *) die "Receipt name is unsafe." ;;
    esac
    receipt_path="/backup/$receipt_name"
    draft_path="/backup/.$receipt_name.tmp"
    [ ! -e "$receipt_path" ] && [ ! -L "$receipt_path" ] ||
      die "Receipt already exists or is unsafe."
    [ ! -e "$draft_path" ] && [ ! -L "$draft_path" ] ||
      die "Receipt draft already exists or is unsafe."

    umask 077
    (set -C; : >"$draft_path") || die "Could not reserve receipt draft."
    defaults_tmp=$(mktemp "${TMPDIR:-/tmp}/ch-core-client.XXXXXX")
    cleanup() {
      rm -f -- "$defaults_tmp"
    }
    trap cleanup EXIT HUP INT TERM
    write_client_defaults "$defaults_tmp" CH_CORE_BACKUP_DATABASE_URL
    database=$(database_name CH_CORE_BACKUP_DATABASE_URL backup)
    mariadb_bin=$(database_binary CH_CORE_MARIADB_BIN mariadb)

    {
      printf "CH_CORE_V022_PREFLIGHT_V1\n"
      printf "TIME_WITA=%s\n" "$time_wita"
      printf "CLIENT_STATE_WINDOWS=%s\n" "$windows_state"
      printf "OUTBOX_WINDOWS=%s\n" "$windows_outbox"
      printf "CLIENT_STATE_ANDROID=%s\n" "$android_state"
      printf "OUTBOX_ANDROID=%s\n" "$android_outbox"
      printf "QUIESCED=YES\n"
      printf "EXPECTED_PRE_V2_STOCK_CHECKS=ABSENT\n"
    } >>"$draft_path"

    for table in $required_tables; do
      case "$table" in
        schema_migrations|devices|pairings|owner_recovery|skus|sku_identifiers|price_history|templates|imports|image_assets|image_jobs|notas|nota_pages|nota_lines|nota_postings|nota_daily_sequences|nota_conflicts|revenue_postings|stock_movements|stock_balances|stock_checks|idempotency_receipts|audit_events|client_cursor_acknowledgements|change_log|business_write_lock) ;;
        *) die "Unexpected table in preflight allowlist." ;;
      esac
      exists=$("$mariadb_bin" --defaults-extra-file="$defaults_tmp" \
        --batch --skip-column-names "$database" \
        -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = '\''$table'\''")
      case "$exists" in
        0)
          printf "TABLE_ABSENT=%s\n" "$table" >>"$draft_path"
          [ "$table" = stock_checks ] ||
            die "Required pre-v2 table is absent."
          ;;
        1)
          [ "$table" != stock_checks ] ||
            die "Unexpected stock_checks table exists before Core v2 migration."
          count=$("$mariadb_bin" --defaults-extra-file="$defaults_tmp" \
            --batch --skip-column-names "$database" \
            -e "SELECT COUNT(*) FROM \`$table\`")
          case "$count" in
            0|[1-9][0-9]*) ;;
            *) die "Database returned an invalid table count." ;;
          esac
          if [ "$table" = business_write_lock ] && [ "$count" != 1 ]; then
            die "business_write_lock must contain exactly one row."
          fi
          printf "TABLE_COUNT=%s|%s\n" "$table" "$count" >>"$draft_path"
          ;;
        *) die "Database returned an invalid table-presence result." ;;
      esac
    done

    actual_migrations=$("$mariadb_bin" --defaults-extra-file="$defaults_tmp" \
      --batch --skip-column-names "$database" \
      -e "SELECT CONCAT(version, '\''|'\'', name, '\''|'\'', LOWER(HEX(checksum))) FROM schema_migrations ORDER BY version")
    [ "$actual_migrations" = "$expected_migrations" ] ||
      die "Live pre-v2 migrations do not match reviewed versions 1-9."
    printf "%s\n" "$actual_migrations" |
      while IFS= read -r migration; do
        printf "SCHEMA_MIGRATION=%s\n" "$migration" >>"$draft_path"
      done
  ' ch-core-v022-counts "$receipt_name" "$time_wita" "$required_tables" "$expected_migrations" \
    "$windows_state" "$windows_outbox" "$android_state" "$android_outbox"

docker compose --profile ops run --rm ch-core-ops \
  /opt/ch-core-ops/dump-database.sh "$bundle_path"
docker compose --profile ops run --rm ch-core-ops \
  /opt/ch-core-ops/verify-dump.sh "$bundle_path"

docker compose --profile ops run --rm ch-core-ops \
  /bin/sh -eu -c '
    . /opt/ch-core-ops/database-common.sh
    receipt_name=$1
    bundle_name=$2
    receipt_path="/backup/$receipt_name"
    draft_path="/backup/.$receipt_name.tmp"
    checksum_path="/backup/$bundle_name/dump.sql.sha256"
    [ -f "$draft_path" ] && [ ! -L "$draft_path" ] ||
      die "Receipt draft is unavailable or unsafe."
    [ ! -e "$receipt_path" ] && [ ! -L "$receipt_path" ] ||
      die "Receipt target already exists or is unsafe."
    [ -f "$checksum_path" ] && [ ! -L "$checksum_path" ] ||
      die "Verified dump checksum is unavailable or unsafe."
    checksum=$(awk '\''NR == 1 && NF == 2 && $2 == "dump.sql" { print $1 }'\'' "$checksum_path")
    [ "${#checksum}" -eq 64 ] || die "Verified dump checksum is invalid."
    case "$checksum" in
      *[!0-9a-fA-F]*) die "Verified dump checksum is invalid." ;;
    esac
    printf "BACKUP_BUNDLE=%s\n" "$bundle_name" >>"$draft_path"
    printf "BACKUP_SHA256=%s\n" "$checksum" >>"$draft_path"
    printf "BACKUP_VERIFIED=YES\n" >>"$draft_path"
    chmod 600 "$draft_path"
    mv -- "$draft_path" "$receipt_path"
    printf "Completed sanitized preflight receipt: %s\n" "$receipt_path"
  ' ch-core-v022-finalize "$receipt_name" "$bundle_name"

printf 'Preflight completed without deploy or migration: %s / %s\n' \
  "$receipt_name" "$bundle_name"
