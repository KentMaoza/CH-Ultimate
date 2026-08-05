#!/bin/sh
set -eu

die() {
  printf '%s\n' "$1" >&2
  exit 1
}

[ "${CH_CORE_PREPARE_APPROVED:-}" = 'YES' ] ||
  die 'Set CH_CORE_PREPARE_APPROVED=YES only after owner approval.'
[ "$(id -u)" -eq 0 ] || die 'This one-time preparation must run as root.'

umask 077

release_commit='dc76d3c0529233974f0d1ec18420a230d0c768a5'
archive_root="ch-ultimate-$release_commit"
staging_root='/volume1/homes/kentmaoza/CH_Ultimate_Pilot/dc76d3c'
source_archive="$staging_root/ch-ultimate-$release_commit.tar.gz"
expected_archive_sha256='55f193d8b483223c322e69312b86a12f90be6f7c42d1da39517ccdd366ca4798'
deployment_parent='/volume1/docker'
target_root='/volume1/docker/ch-ultimate-dc76d3c0529233974f0d1ec18420a230d0c768a5'
receipt="$staging_root/prepare-v022-receipt.txt"
receipt_draft="$staging_root/.prepare-v022-receipt.txt.tmp"

[ -d "$staging_root" ] && [ ! -L "$staging_root" ] ||
  die 'The exact staging directory is unavailable or unsafe.'
[ -d "$deployment_parent" ] && [ ! -L "$deployment_parent" ] ||
  die 'The exact deployment parent is unavailable or unsafe.'
[ -f "$source_archive" ] && [ ! -L "$source_archive" ] ||
  die 'The exact release archive is unavailable or unsafe.'
[ ! -e "$target_root" ] && [ ! -L "$target_root" ] ||
  die 'The exact target deployment directory already exists or is unsafe.'
[ ! -e "$receipt" ] && [ ! -L "$receipt" ] ||
  die 'The preparation receipt already exists or is unsafe.'
[ ! -e "$receipt_draft" ] && [ ! -L "$receipt_draft" ] ||
  die 'The preparation receipt draft already exists or is unsafe.'

actual_archive_sha256=$(sha256sum "$source_archive" | awk 'NR == 1 {print $1}')
[ "$actual_archive_sha256" = "$expected_archive_sha256" ] ||
  die 'The staged release archive checksum does not match.'

tar -tzf "$source_archive" |
  awk -v prefix="$archive_root/" '
    index($0, prefix) != 1 { bad = 1 }
    $0 ~ /(^|\/)\.\.(\/|$)/ { bad = 1 }
    END { exit bad }
  ' || die 'The staged release archive contains an unexpected path.'

mkdir -m 0700 "$target_root"
tar -xzf "$source_archive" -C "$deployment_parent"

for required in \
  "$target_root/package.json" \
  "$target_root/package-lock.json" \
  "$target_root/server/Dockerfile" \
  "$target_root/server/compose.yaml" \
  "$target_root/server/.env.example"; do
  [ -f "$required" ] && [ ! -L "$required" ] ||
    die "Prepared source is missing a required file: $required"
done

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

migration_count=$(find "$target_root/server/migrations" -type f -name '*.sql' | wc -l | tr -d ' ')
[ "$migration_count" = '10' ] ||
  die 'Prepared source does not contain exactly ten migration files.'

printf '%s\n' "$expected_migrations" |
  while IFS='|' read -r version filename expected_sha256; do
    migration="$target_root/server/migrations/$filename"
    [ -f "$migration" ] && [ ! -L "$migration" ] ||
      die "Prepared source is missing migration $version."
    actual_sha256=$(sha256sum "$migration" | awk 'NR == 1 {print $1}')
    [ "$actual_sha256" = "$expected_sha256" ] ||
      die "Prepared migration $version checksum does not match."
  done

(set -C; : >"$receipt_draft") ||
  die 'Could not reserve the preparation receipt draft.'
{
  printf 'CH_CORE_V022_PREPARE_V1\n'
  printf 'TIME_WITA=%s\n' "$(TZ=Asia/Makassar date '+%Y-%m-%dT%H:%M:%S%z')"
  printf 'SOURCE_COMMIT=%s\n' "$release_commit"
  printf 'SOURCE_ARCHIVE=%s\n' "$source_archive"
  printf 'SOURCE_SHA256=%s\n' "$actual_archive_sha256"
  printf 'TARGET_ROOT=%s\n' "$target_root"
  printf '%s\n' "$expected_migrations" |
    while IFS='|' read -r version filename checksum; do
      printf 'MIGRATION=%s|%s|%s\n' "$version" "$filename" "$checksum"
    done
  printf 'ENVIRONMENT=NOT_CREATED\n'
  printf 'DEPLOYMENT=NOT_STARTED\n'
  printf 'DATABASE=NOT_ACCESSED\n'
} >>"$receipt_draft"
chmod 0600 "$receipt_draft"
mv -- "$receipt_draft" "$receipt"
printf 'Prepared exact v0.2.2 source without environment or deployment: %s\n' \
  "$receipt"
