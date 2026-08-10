#!/bin/sh
set -eu

die() {
  printf '%s\n' "$1" >&2
  exit 1
}

require_regular_file() {
  [ -f "$1" ] && [ ! -L "$1" ] || die "$2 is unavailable or unsafe."
}

require_regular_directory() {
  [ -d "$1" ] && [ ! -L "$1" ] || die "$2 is unavailable or unsafe."
}

require_hex() {
  value=$1
  length=$2
  label=$3
  [ "${#value}" -eq "$length" ] || die "$label has an invalid length."
  case "$value" in
    *[!0-9a-f]*) die "$label must be lowercase hexadecimal." ;;
  esac
}

require_database_password() {
  value=$1
  label=$2
  case "$value" in
    Aa!*) ;;
    *) die "$label does not satisfy the required character classes." ;;
  esac
  random_part=${value#Aa!}
  require_hex "$random_part" 48 "$label random component"
}

sha256_file() {
  sha256sum "$1" | awk 'NR == 1 { print $1 }'
}

require_root_and_approval() {
  [ "${CH_CORE_V024_APPROVED:-}" = 'YES' ] ||
    die 'Set CH_CORE_V024_APPROVED=YES only after owner approval.'
  [ "$(id -u)" -eq 0 ] || die 'This NAS cutover helper must run as root.'
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

require_quiesced_clients() {
  [ "${CH_CORE_V024_QUIESCED:-}" = 'YES' ] ||
    die 'Set CH_CORE_V024_QUIESCED=YES only after every client is closed or uninstalled.'
  windows_state=${CH_CORE_V024_WINDOWS_STATE:-}
  windows_outbox=${CH_CORE_V024_WINDOWS_OUTBOX:-}
  android_state=${CH_CORE_V024_ANDROID_STATE:-}
  android_outbox=${CH_CORE_V024_ANDROID_OUTBOX:-}
  validate_client_gate Windows "$windows_state" "$windows_outbox"
  validate_client_gate Android "$android_state" "$android_outbox"
}

load_release_context() {
  release_commit=${CH_CORE_RELEASE_COMMIT:-}
  archive_sha256=${CH_CORE_RELEASE_ARCHIVE_SHA256:-}
  previous_project_root=${CH_CORE_PREVIOUS_PROJECT_ROOT:-}
  previous_project_name=${CH_CORE_PREVIOUS_PROJECT_NAME:-}
  require_hex "$release_commit" 40 'CH_CORE_RELEASE_COMMIT'
  require_hex "$archive_sha256" 64 'CH_CORE_RELEASE_ARCHIVE_SHA256'
  short_commit=$(printf '%.7s' "$release_commit")
  staging_root=${CH_CORE_STAGING_ROOT:-/volume1/homes/kentmaoza/CH_Ultimate_Pilot/$short_commit}
  target_root="/volume1/docker/ch-ultimate-$release_commit"
  project_root="$target_root/server"
  archive="$staging_root/ch-ultimate-$release_commit.tar.gz"
  prepare_receipt="$staging_root/prepare-v024-receipt.txt"
  backup_receipt=${CH_CORE_V024_BACKUP_RECEIPT:-$staging_root/backup-v024-receipt.txt}
  deploy_receipt="$staging_root/deploy-v024-receipt.txt"
  validation_receipt="$staging_root/validation-v024-receipt.txt"
  backup_root='/volume1/docker/ch-ultimate-backups'
  new_project_name="ch-ultimate-core-$short_commit"

  require_regular_directory "$staging_root" 'Exact staging directory'
  case "$staging_root" in
    /volume1/homes/kentmaoza/CH_Ultimate_Pilot/[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
    *) die 'CH_CORE_STAGING_ROOT is outside the approved staging boundary.' ;;
  esac
  case "$previous_project_root" in
    /volume1/docker/ch-ultimate-*/server)
      previous_project_commit=${previous_project_root#/volume1/docker/ch-ultimate-}
      previous_project_commit=${previous_project_commit%/server}
      case "${#previous_project_commit}" in
        7|40) ;;
        *) die 'CH_CORE_PREVIOUS_PROJECT_ROOT has an invalid commit length.' ;;
      esac
      case "$previous_project_commit" in
        *[!0-9a-f]*) die 'CH_CORE_PREVIOUS_PROJECT_ROOT commit must be lowercase hexadecimal.' ;;
      esac
      ;;
    *) die 'CH_CORE_PREVIOUS_PROJECT_ROOT is outside the approved deployment boundary.' ;;
  esac
  case "$previous_project_name" in
    ch-ultimate-core-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
    *) die 'CH_CORE_PREVIOUS_PROJECT_NAME is invalid.' ;;
  esac
  [ "$previous_project_root" != "$project_root" ] ||
    die 'Previous and target project roots must be different.'
  [ "$backup_receipt" = "$staging_root/backup-v024-receipt.txt" ] ||
    die 'CH_CORE_V024_BACKUP_RECEIPT must be the exact release receipt path.'
}

expected_migrations='1|001_initial.sql|e22cfbbf1af7b72e0091c9bf8a399ac2570fc6f971723330d085d0954cf68b69
2|002_nota_line_page_ownership.sql|39fd3afbe56aef8fa4b5c317753622998f73877925f1eed24996686721f17923
3|003_identity_sync_protocol.sql|cb1ab6f8382317cf9e3abfde5f9f4edf6883eea75f06cc0c6b1d4ac54dbde581
4|004_replay_safe_protocol.sql|e82b21d3e86680432f270b51a1d61c79cd0c69105f9e9ab8212768dcc1387139
5|005_catalogue_import.sql|b36063e077279b11997bed0cb4577053b7ff6f3ff7ef19e2c13d5678163209b0
6|006_business_write_safety.sql|dbe0d11d5df5c3241c985afd2db37ce37cea24231397e62e5e8711ea84403cad
7|007_active_template_kind.sql|b03215e308d94c374cc8e2d63da47599f85cf3338f788baf3add26a47ec1ae44
8|008_nota_authority.sql|a75edec750744aa68b28be3e53b50ea001b7be0c8a50c8ea413a309adeef2cfc
9|009_offline_operations.sql|e4a35e360a8e726dc0cbfa202b9f445b684a39172ce42c8944c3a975dce892c1
10|010_stock_checks.sql|6aaa1aa921b939aad93bc1730dd46a3c1f3a0f4fa55484c5f55565b3317af105'

verify_prepared_source() {
  require_regular_directory "$project_root" 'Prepared CH Core project'
  for required in package.json package-lock.json server/Dockerfile server/compose.yaml server/scripts/ch-core-v024-count-validator.sh; do
    require_regular_file "$target_root/$required" "Prepared source $required"
  done
  migration_count=$(find "$project_root/migrations" -type f -name '*.sql' | wc -l | tr -d ' ')
  [ "$migration_count" = '10' ] || die 'Prepared source must contain exactly ten migrations.'
  printf '%s\n' "$expected_migrations" |
    while IFS='|' read -r version filename expected_sha256; do
      migration="$project_root/migrations/$filename"
      require_regular_file "$migration" "Migration $version"
      [ "$(sha256_file "$migration")" = "$expected_sha256" ] ||
        die "Migration $version checksum does not match."
    done
}

prepare_release() {
  require_regular_file "$archive" 'Exact release archive'
  [ "$(sha256_file "$archive")" = "$archive_sha256" ] ||
    die 'Release archive checksum does not match.'
  require_regular_directory "$previous_project_root" 'Previous CH Core project'
  require_regular_file "$previous_project_root/.env" 'Previous CH Core environment'
  [ ! -e "$target_root" ] && [ ! -L "$target_root" ] ||
    die 'Target release directory already exists or is unsafe.'
  [ ! -e "$prepare_receipt" ] && [ ! -L "$prepare_receipt" ] ||
    die 'Prepare receipt already exists or is unsafe.'

  archive_root="ch-ultimate-$release_commit/"
  tar -tzf "$archive" |
    awk -v prefix="$archive_root" '
      index($0, prefix) != 1 { bad = 1 }
      $0 ~ /(^|\/)\.\.(\/|$)/ { bad = 1 }
      END { exit bad }
    ' || die 'Release archive contains an unexpected path.'
  tar -xzf "$archive" -C /volume1/docker
  verify_prepared_source
  cp "$previous_project_root/.env" "$project_root/.env"
  chmod 0600 "$project_root/.env"

  umask 077
  {
    printf 'CH_CORE_V024_PREPARE_V1\n'
    printf 'TIME_WITA=%s\n' "$(TZ=Asia/Makassar date '+%Y-%m-%dT%H:%M:%S%z')"
    printf 'SOURCE_COMMIT=%s\n' "$release_commit"
    printf 'SOURCE_SHA256=%s\n' "$archive_sha256"
    printf 'PREVIOUS_PROJECT=%s\n' "$previous_project_name"
    printf 'TARGET_PROJECT=%s\n' "$new_project_name"
    printf 'ENVIRONMENT=COPIED_WITHOUT_OUTPUT\n'
    printf 'DATABASE=NOT_ACCESSED\n'
    printf 'DEPLOYMENT=NOT_STARTED\n'
  } >"$prepare_receipt"
  chmod 0600 "$prepare_receipt"
  printf 'Prepared v0.2.4 source: %s\n' "$prepare_receipt"
}

mariadb_admin_binary() {
  for candidate in \
    /usr/local/mariadb10/bin/mariadb \
    /var/packages/MariaDB10/target/usr/local/mariadb10/bin/mariadb \
    /var/packages/MariaDB10/target/usr/local/mariadb10/bin/mysql; do
    if [ -x "$candidate" ]; then
      printf '%s' "$candidate"
      return
    fi
  done
  die 'The reviewed MariaDB 10 administrator client is unavailable.'
}

configure_ops_credentials() {
  admin_defaults=${CH_CORE_MARIADB_ADMIN_DEFAULTS:-}
  case "$admin_defaults" in
    "$staging_root"/.mariadb-admin.cnf) ;;
    *) die 'CH_CORE_MARIADB_ADMIN_DEFAULTS must be the exact staged admin defaults path.' ;;
  esac
  require_regular_file "$admin_defaults" 'MariaDB administrator defaults'
  chmod 0600 "$admin_defaults"
  grep -qx '\[client\]' "$admin_defaults" || die 'MariaDB administrator defaults have no client section.'
  grep -qx 'protocol=socket' "$admin_defaults" || die 'MariaDB administrator defaults are not socket-only.'
  grep -qx 'socket=/run/mysqld/mysqld10.sock' "$admin_defaults" || die 'MariaDB administrator socket differs.'
  grep -qx 'user=root' "$admin_defaults" || die 'MariaDB administrator identity differs.'
  if grep -Eq '^(host|port)=' "$admin_defaults"; then
    die 'MariaDB administrator defaults may not contain a TCP host or port.'
  fi
  mariadb_admin=$(mariadb_admin_binary)

  existing=$(
    "$mariadb_admin" --defaults-extra-file="$admin_defaults" --batch --skip-column-names \
      -e "SELECT
        (SELECT COUNT(*) FROM mysql.user WHERE User IN ('chu_backup_v024','chu_restore_v024')) +
        (SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name = 'chu_restore_v024')"
  )
  [ "$existing" = '0' ] || die 'Dedicated v0.2.4 ops accounts or scratch schema already exist.'

  password_generator="$target_root/scripts/ch-core-v024-database-password.sh"
  require_regular_file "$password_generator" 'Database password generator'
  [ -x "$password_generator" ] || die 'Database password generator is not executable.'
  backup_password=$("$password_generator")
  restore_password=$("$password_generator")
  require_database_password "$backup_password" 'Generated backup password'
  require_database_password "$restore_password" 'Generated restore password'
  "$mariadb_admin" --defaults-extra-file="$admin_defaults" <<SQL
CREATE USER 'chu_backup_v024'@'localhost' IDENTIFIED BY '$backup_password';
GRANT SELECT, SHOW VIEW, TRIGGER, EVENT, LOCK TABLES ON chu.* TO 'chu_backup_v024'@'localhost';
CREATE DATABASE chu_restore_v024 CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'chu_restore_v024'@'localhost' IDENTIFIED BY '$restore_password';
GRANT ALL PRIVILEGES ON chu_restore_v024.* TO 'chu_restore_v024'@'localhost';
SQL

  runtime_uid=$(awk -F= '/^CH_CORE_RUNTIME_UID=/{ value=$2 } END { print value }' "$project_root/.env")
  runtime_gid=$(awk -F= '/^CH_CORE_RUNTIME_GID=/{ value=$2 } END { print value }' "$project_root/.env")
  case "$runtime_uid:$runtime_gid" in
    0:*|*:0|*[!0-9:]*|:*) die 'Runtime UID/GID in the copied environment is invalid.' ;;
  esac
  if [ ! -e "$backup_root" ]; then
    mkdir -m 0700 "$backup_root"
  fi
  require_regular_directory "$backup_root" 'Same-NAS backup root'
  chown "$runtime_uid:$runtime_gid" "$backup_root"
  chmod 0700 "$backup_root"

  env_draft="$project_root/.env.v024.tmp"
  [ ! -e "$env_draft" ] && [ ! -L "$env_draft" ] || die 'Environment draft already exists or is unsafe.'
  awk '
    !/^(CH_CORE_BACKUP_DATABASE_URL|CH_CORE_RESTORE_DATABASE_URL|CH_CORE_MARIADB_SOCKET|CH_CORE_BACKUP_HOST_PATH)=/
  ' "$project_root/.env" >"$env_draft"
  {
    printf 'CH_CORE_BACKUP_DATABASE_URL=mariadb://chu_backup_v024:%s@localhost/chu\n' "$backup_password"
    printf 'CH_CORE_RESTORE_DATABASE_URL=mariadb://chu_restore_v024:%s@localhost/chu_restore_v024\n' "$restore_password"
    printf 'CH_CORE_MARIADB_SOCKET=/run/mysqld/mysqld10.sock\n'
    printf 'CH_CORE_BACKUP_HOST_PATH=%s\n' "$backup_root"
  } >>"$env_draft"
  chmod 0600 "$env_draft"
  mv -- "$env_draft" "$project_root/.env"
  unset backup_password restore_password
}

capture_predeploy_counts() {
  docker compose --project-name "$new_project_name-ops" --profile ops run --rm ch-core-ops \
    /bin/sh -eu -c '
      . /opt/ch-core-ops/database-common.sh
      defaults=$(mktemp "${TMPDIR:-/tmp}/ch-core-counts.XXXXXX")
      trap '\''rm -f -- "$defaults"'\'' EXIT HUP INT TERM
      write_client_defaults "$defaults" CH_CORE_BACKUP_DATABASE_URL
      database=$(database_name CH_CORE_BACKUP_DATABASE_URL backup)
      mariadb_bin=$(database_binary CH_CORE_MARIADB_BIN mariadb)
      stock_checks_table_present=0
      tables="schema_migrations devices pairings owner_recovery skus sku_identifiers price_history templates imports image_assets image_jobs notas nota_pages nota_lines nota_postings nota_daily_sequences nota_conflicts revenue_postings stock_movements stock_balances stock_checks idempotency_receipts audit_events client_cursor_acknowledgements change_log business_write_lock"
      for table in $tables; do
        exists=$("$mariadb_bin" --defaults-extra-file="$defaults" --batch --skip-column-names "$database" -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = '\''$table'\''")
        case "$exists:$table" in
          0:stock_checks) printf "TABLE_ABSENT=stock_checks\\n" ;;
          1:*)
            count=$("$mariadb_bin" --defaults-extra-file="$defaults" --batch --skip-column-names "$database" -e "SELECT COUNT(*) FROM \`$table\`")
            /opt/ch-core-ops/ch-core-v024-count-validator.sh "$count"
            [ "$table" != business_write_lock ] || [ "$count" = 1 ] || die "business_write_lock must have one row."
            [ "$table" != stock_checks ] || stock_checks_table_present=1
            printf "TABLE_COUNT=%s|%s\\n" "$table" "$count"
            ;;
          *) die "Unexpected table presence for $table." ;;
        esac
      done
      migrations=$("$mariadb_bin" --defaults-extra-file="$defaults" --batch --skip-column-names "$database" -e "SELECT COUNT(*) FROM schema_migrations")
      case "$migrations" in
        9|10) ;;
        *) die "Predeploy schema must contain exactly migrations 1-9 or 1-10." ;;
      esac
      printf "PREDEPLOY_MIGRATIONS=%s\\n" "$migrations"

      business_notas=$("$mariadb_bin" --defaults-extra-file="$defaults" --batch --skip-column-names "$database" -e "SELECT COUNT(*) FROM notas")
      business_stock_movements=$("$mariadb_bin" --defaults-extra-file="$defaults" --batch --skip-column-names "$database" -e "SELECT COUNT(*) FROM stock_movements")
      business_stock_checks=0
      if [ "$stock_checks_table_present" = 1 ]; then
        business_stock_checks=$("$mariadb_bin" --defaults-extra-file="$defaults" --batch --skip-column-names "$database" -e "SELECT COUNT(*) FROM stock_checks")
      fi
      business_non_import_price_history=$("$mariadb_bin" --defaults-extra-file="$defaults" --batch --skip-column-names "$database" -e "SELECT COUNT(*) FROM price_history WHERE source <> '\''catalogue_import'\''")
      for business_count in "$business_notas" "$business_stock_movements" "$business_stock_checks" "$business_non_import_price_history"; do
        /opt/ch-core-ops/ch-core-v024-count-validator.sh "$business_count"
      done
      printf "BUSINESS_COUNT=notas|%s\\n" "$business_notas"
      printf "BUSINESS_COUNT=stock_movements|%s\\n" "$business_stock_movements"
      printf "BUSINESS_COUNT=stock_checks|%s\\n" "$business_stock_checks"
      printf "BUSINESS_COUNT=non_import_price_history|%s\\n" "$business_non_import_price_history"
    '
}

backup_and_restore() {
  require_quiesced_clients
  verify_prepared_source
  require_regular_file "$prepare_receipt" 'v0.2.4 prepare receipt'
  [ ! -e "$backup_receipt" ] && [ ! -L "$backup_receipt" ] ||
    die 'Backup receipt already exists or is unsafe.'
  configure_ops_credentials
  cd "$project_root"
  docker compose --project-name "$new_project_name-ops" --profile ops build ch-core-ops
  counts=$(capture_predeploy_counts)
  stamp=$(TZ=Asia/Makassar date '+%Y%m%d-%H%M%S')
  case "$stamp" in
    [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]) ;;
    *) die 'Could not generate a safe WITA timestamp.' ;;
  esac
  bundle_path="/backup/chu-v024-${stamp}.bundle"
  docker compose --project-name "$new_project_name-ops" --profile ops run --rm ch-core-ops \
    /opt/ch-core-ops/dump-database.sh "$bundle_path"
  docker compose --project-name "$new_project_name-ops" --profile ops run --rm ch-core-ops \
    /opt/ch-core-ops/verify-dump.sh "$bundle_path"
  docker compose --project-name "$new_project_name-ops" --profile ops run --rm ch-core-ops \
    /opt/ch-core-ops/restore-scratch.sh "$bundle_path"
  comparison=$(docker compose --project-name "$new_project_name-ops" --profile ops run --rm ch-core-ops \
    /opt/ch-core-ops/compare-scratch.sh)
  printf '%s\n' "$comparison" | grep -qx 'MATCH=YES' || die 'Scratch canonical comparison did not match.'
  canonical_sha=$(printf '%s\n' "$comparison" | awk -F= '/^CANONICAL_SHA256=/{ print $2 }')
  require_hex "$canonical_sha" 64 'Canonical scratch checksum'
  bundle_name=${bundle_path#/backup/}
  bundle_sha=$(awk 'NR == 1 { print $1 }' "$backup_root/$bundle_name/dump.sql.sha256")
  require_hex "$bundle_sha" 64 'Backup dump checksum'

  umask 077
  {
    printf 'CH_CORE_V024_BACKUP_RESTORE_V1\n'
    printf 'TIME_WITA=%s\n' "$(TZ=Asia/Makassar date '+%Y-%m-%dT%H:%M:%S%z')"
    printf 'SOURCE_COMMIT=%s\n' "$release_commit"
    printf 'CLIENT_STATE_WINDOWS=%s\n' "$windows_state"
    printf 'OUTBOX_WINDOWS=%s\n' "$windows_outbox"
    printf 'CLIENT_STATE_ANDROID=%s\n' "$android_state"
    printf 'OUTBOX_ANDROID=%s\n' "$android_outbox"
    printf 'QUIESCED=YES\n'
    printf '%s\n' "$counts"
    printf 'BACKUP_BUNDLE=%s\n' "$bundle_name"
    printf 'BACKUP_SHA256=%s\n' "$bundle_sha"
    printf 'BACKUP_VERIFIED=YES\n'
    printf 'SCRATCH_SCHEMA=chu_restore_v024\n'
    printf 'SCRATCH_RESTORE=PASS\n'
    printf 'CANONICAL_SHA256=%s\n' "$canonical_sha"
    printf 'CANONICAL_MATCH=YES\n'
    printf 'MATCH=YES\n'
  } >"$backup_receipt"
  chmod 0600 "$backup_receipt"
  printf 'Backup and scratch restore completed: %s\n' "$backup_receipt"
}

require_verified_backup_receipt() {
  require_regular_file "$backup_receipt" 'v0.2.4 backup receipt'
  grep -qx 'BACKUP_VERIFIED=YES' "$backup_receipt" || die 'Backup verification marker is missing.'
  grep -qx 'SCRATCH_RESTORE=PASS' "$backup_receipt" || die 'Scratch restore marker is missing.'
  grep -qx 'CANONICAL_MATCH=YES' "$backup_receipt" || die 'Canonical match marker is missing.'
  grep -qx 'QUIESCED=YES' "$backup_receipt" || die 'Quiesced-client marker is missing.'
  grep -qx "SOURCE_COMMIT=$release_commit" "$backup_receipt" || die 'Backup receipt source commit differs.'
  receipt_bundle=$(awk -F= '/^BACKUP_BUNDLE=/{ print $2 }' "$backup_receipt")
  receipt_sha=$(awk -F= '/^BACKUP_SHA256=/{ print $2 }' "$backup_receipt")
  case "$receipt_bundle" in
    chu-v024-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9].bundle) ;;
    *) die 'Backup receipt bundle name is invalid.' ;;
  esac
  require_hex "$receipt_sha" 64 'Backup receipt checksum'
  receipt_bundle_root="$backup_root/$receipt_bundle"
  require_regular_directory "$receipt_bundle_root" 'Verified backup bundle'
  require_regular_file "$receipt_bundle_root/dump.sql" 'Verified backup dump'
  require_regular_file "$receipt_bundle_root/dump.sql.sha256" 'Verified backup checksum file'
  require_regular_file "$receipt_bundle_root/COMPLETE" 'Verified backup completion marker'
  [ "$(sha256_file "$receipt_bundle_root/dump.sql")" = "$receipt_sha" ] ||
    die 'Verified backup bytes changed after the restore drill.'
}

deploy_release() {
  require_quiesced_clients
  verify_prepared_source
  require_verified_backup_receipt
  [ ! -e "$deploy_receipt" ] && [ ! -L "$deploy_receipt" ] ||
    die 'Deploy receipt already exists or is unsafe.'
  require_regular_directory "$previous_project_root" 'Previous CH Core project'
  cd "$project_root"
  docker compose --project-name "$new_project_name" build ch-core
  cd "$previous_project_root"
  docker compose --project-name "$previous_project_name" stop ch-core
  cd "$project_root"
  docker compose --project-name "$new_project_name" up -d --no-build ch-core

  ready='NO'
  attempts=0
  while [ "$attempts" -lt 30 ]; do
    if docker compose --project-name "$new_project_name" exec -T ch-core \
      node -e "fetch('http://127.0.0.1:18080/health/ready',{signal:AbortSignal.timeout(3000)}).then(async r=>{if(!r.ok||!(await r.json()).status)process.exit(1)}).catch(()=>process.exit(1))"; then
      ready='YES'
      break
    fi
    attempts=$((attempts + 1))
    sleep 2
  done
  [ "$ready" = 'YES' ] || die 'New CH Core did not become ready; preserve evidence and forward-fix.'

  umask 077
  {
    printf 'CH_CORE_V024_DEPLOY_V1\n'
    printf 'TIME_WITA=%s\n' "$(TZ=Asia/Makassar date '+%Y-%m-%dT%H:%M:%S%z')"
    printf 'SOURCE_COMMIT=%s\n' "$release_commit"
    printf 'PREVIOUS_PROJECT=%s|STOPPED\n' "$previous_project_name"
    printf 'TARGET_PROJECT=%s|RUNNING\n' "$new_project_name"
    printf 'DEPLOYMENT_STATE=RUNNING_UNVALIDATED\n'
    printf 'LOOPBACK_HEALTH_READY=YES\n'
  } >"$deploy_receipt"
  chmod 0600 "$deploy_receipt"
  printf 'Deployed v0.2.4 CH Core: %s\n' "$deploy_receipt"
}

validate_release() {
  require_regular_file "$deploy_receipt" 'v0.2.4 deploy receipt'
  grep -qx "SOURCE_COMMIT=$release_commit" "$deploy_receipt" ||
    die 'Deploy receipt source commit differs.'
  grep -qx 'DEPLOYMENT_STATE=RUNNING_UNVALIDATED' "$deploy_receipt" ||
    die 'Deploy receipt is not awaiting validation.'
  [ ! -e "$validation_receipt" ] && [ ! -L "$validation_receipt" ] ||
    die 'Validation receipt already exists or is unsafe.'

  validation_token_file=${CH_CORE_V024_VALIDATION_TOKEN_FILE:-}
  [ "$validation_token_file" = "$staging_root/.validation-bearer" ] ||
    die 'CH_CORE_V024_VALIDATION_TOKEN_FILE must be the exact staged bearer path.'
  require_regular_file "$validation_token_file" 'Validation bearer file'
  chmod 0600 "$validation_token_file"
  validation_token=$(tr -d '\r\n' <"$validation_token_file")
  case "$validation_token" in
    ''|*[!A-Za-z0-9_-]*) die 'Validation bearer has an invalid format.' ;;
  esac
  [ "${#validation_token}" -ge 32 ] || die 'Validation bearer is too short.'

  cd "$project_root"
  schema_evidence=$(docker compose --project-name "$new_project_name-ops" --profile ops run --rm ch-core-ops \
    /bin/sh -eu -c '
      . /opt/ch-core-ops/database-common.sh
      defaults=$(mktemp "${TMPDIR:-/tmp}/ch-core-schema.XXXXXX")
      trap '\''rm -f -- "$defaults"'\'' EXIT HUP INT TERM
      write_client_defaults "$defaults" CH_CORE_BACKUP_DATABASE_URL
      database=$(database_name CH_CORE_BACKUP_DATABASE_URL backup)
      mariadb_bin=$(database_binary CH_CORE_MARIADB_BIN mariadb)
      count=$("$mariadb_bin" --defaults-extra-file="$defaults" --batch --skip-column-names "$database" -e "SELECT COUNT(*) FROM schema_migrations")
      latest=$("$mariadb_bin" --defaults-extra-file="$defaults" --batch --skip-column-names "$database" -e "SELECT MAX(version) FROM schema_migrations")
      [ "$count" = 10 ] || die "Applied migration count is not 10."
      [ "$latest" = 10 ] || die "Latest migration version is not 10."
      printf "APPLIED_MIGRATIONS=10\nLATEST_SCHEMA_VERSION=10\n"
    ')
  printf '%s\n' "$schema_evidence" | grep -qx 'APPLIED_MIGRATIONS=10' ||
    die 'Measured migration count marker is missing.'
  printf '%s\n' "$schema_evidence" | grep -qx 'LATEST_SCHEMA_VERSION=10' ||
    die 'Measured latest migration marker is missing.'

  public_base_url='https://192.168.50.14:8443'
  ca_cert="$target_root/resources/ch-core-ca.pem"
  require_regular_file "$ca_cert" 'CH Core CA certificate'
  live_body=$(curl --fail --silent --show-error --cacert "$ca_cert" "$public_base_url/health/live")
  ready_body=$(curl --fail --silent --show-error --cacert "$ca_cert" "$public_base_url/health/ready")
  [ "$live_body" = '{"status":"ok"}' ] || die 'Public CA-validated live health failed.'
  [ "$ready_body" = '{"status":"ready"}' ] || die 'Public CA-validated ready health failed.'

  umask 077
  bootstrap_curl_config=$(mktemp "${TMPDIR:-/tmp}/ch-core-bootstrap-curl.XXXXXX")
  bootstrap_body_file=$(mktemp "${TMPDIR:-/tmp}/ch-core-bootstrap-body.XXXXXX")
  cleanup_validation_temps() {
    [ -z "${bootstrap_curl_config:-}" ] || rm -f -- "$bootstrap_curl_config"
    [ -z "${bootstrap_body_file:-}" ] || rm -f -- "$bootstrap_body_file"
  }
  trap cleanup_validation_temps EXIT HUP INT TERM
  printf 'header = "Authorization: Bearer %s"\n' "$validation_token" >"$bootstrap_curl_config"
  unset validation_token
  curl --fail --silent --show-error --cacert "$ca_cert" \
    --config "$bootstrap_curl_config" --output "$bootstrap_body_file" \
    "${public_base_url}/v1/bootstrap"
  rm -f -- "$bootstrap_curl_config"
  bootstrap_curl_config=''

  bootstrap_evidence=$(docker compose --project-name "$new_project_name" exec -T ch-core \
    node --input-type=module -e '
      import { z } from "zod";
      let json = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => { json += chunk; });
      process.stdin.on("end", () => {
        const canonicalDecimal = z.string().regex(/^(0|[1-9]\d*)$/);
        const signedDecimal = z.string().regex(/^(0|-?[1-9]\d*)$/);
        const timestamp = z.string().datetime({ offset: true });
        const uuid = z.string().uuid();
        const stockCheckSchema = z.object({
          id: uuid,
          skuId: uuid,
          observedQuantityPcs: signedDecimal,
          countedQuantityPcs: signedDecimal,
          serverQuantityBeforePcs: signedDecimal,
          appliedDeltaPcs: signedDecimal,
          baseBalanceVersion: canonicalDecimal.optional(),
          forcedOffline: z.boolean(),
          countedAt: timestamp,
          appliedAt: timestamp,
          deviceId: uuid,
          deviceDisplayName: z.string().min(1).max(160),
          note: z.string().trim().max(512).optional(),
        }).strict();
        const validStockCheck = (row) => stockCheckSchema.safeParse(row).success;
        const body = JSON.parse(json);
        if (
          body.apiSchemaVersion !== 2 ||
          !Array.isArray(body.stockChecks) ||
          !body.stockChecks.every(validStockCheck)
        ) process.exit(1);
        console.log("AUTHENTICATED_BOOTSTRAP_V2=YES");
        console.log(`STOCK_CHECKS_COUNT=${body.stockChecks.length}`);
      });
    ' <"$bootstrap_body_file")
  rm -f -- "$bootstrap_body_file"
  bootstrap_body_file=''
  trap - EXIT HUP INT TERM
  printf '%s\n' "$bootstrap_evidence" | grep -qx 'AUTHENTICATED_BOOTSTRAP_V2=YES' ||
    die 'Authenticated bootstrap v2 marker is missing.'
  stock_checks_count=$(printf '%s\n' "$bootstrap_evidence" | awk -F= '/^STOCK_CHECKS_COUNT=/{ print $2 }')
  "$target_root/server/scripts/ch-core-v024-count-validator.sh" "$stock_checks_count"

  umask 077
  {
    printf 'CH_CORE_V024_VALIDATION_V1\n'
    printf 'TIME_WITA=%s\n' "$(TZ=Asia/Makassar date '+%Y-%m-%dT%H:%M:%S%z')"
    printf 'SOURCE_COMMIT=%s\n' "$release_commit"
    printf '%s\n' "$schema_evidence"
    printf 'PUBLIC_HEALTH_LIVE=YES\n'
    printf 'PUBLIC_HEALTH_READY=YES\n'
    printf 'AUTHENTICATED_BOOTSTRAP_V2=YES\n'
    printf 'STOCK_CHECKS_COUNT=%s\n' "$stock_checks_count"
    printf 'DEPLOYMENT_ACCEPTED=YES\n'
  } >"$validation_receipt"
  chmod 0600 "$validation_receipt"
  printf 'Validated v0.2.4 CH Core: %s\n' "$validation_receipt"
}

[ "$#" -eq 1 ] || die 'Usage: ch-core-v024-nas-cutover.sh prepare|backup-restore|deploy|validate'
phase=$1
require_root_and_approval
load_release_context

case "$phase" in
  prepare) prepare_release ;;
  backup-restore) backup_and_restore ;;
  deploy) deploy_release ;;
  validate) validate_release ;;
  *) die 'Usage: ch-core-v024-nas-cutover.sh prepare|backup-restore|deploy|validate' ;;
esac
