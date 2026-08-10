#!/bin/sh
set -eu

die() {
  printf '%s\n' "$1" >&2
  exit 1
}

require_absolute_path() {
  case "$1" in
    /*) ;;
    *) die "$2 must be an absolute path." ;;
  esac
}

require_backup_bundle_path() {
  bundle_path=$1
  backup_root=${2:-/backup}
  require_absolute_path "$bundle_path" 'Backup bundle path'
  [ -d "$backup_root" ] && [ ! -L "$backup_root" ] ||
    die 'Backup root must be an existing regular non-symlink directory.'
  canonical_root=$(CDPATH= cd -P -- "$backup_root" && pwd)
  [ "$canonical_root" = "$backup_root" ] ||
    die 'Backup root must be canonical and may not contain symlink ancestors.'

  case "$bundle_path" in
    "$backup_root"/*.bundle) ;;
    *)
      die 'Backup bundle must be exactly /backup/<safe-name>.bundle.'
      ;;
  esac
  bundle_name=${bundle_path#"$backup_root"/}
  case "$bundle_name" in
    ''|.*|*/*|*[!A-Za-z0-9._-]*|.bundle)
      die 'Backup bundle must be exactly /backup/<safe-name>.bundle.'
      ;;
  esac
  [ "$(dirname -- "$bundle_path")" = "$backup_root" ] ||
    die 'Nested backup bundle paths are not allowed.'
  [ ! -L "$bundle_path" ] ||
    die 'Backup bundle target may not be a symlink.'
}

write_client_defaults() {
  defaults_path=$1
  database_env_name=$2
  node --input-type=module - "$defaults_path" "$database_env_name" <<'NODE'
import fs from 'node:fs';

const [target, environmentName] = process.argv.slice(2);
const rawUrl = process.env[environmentName];
const socketPath = process.env.CH_CORE_MARIADB_SOCKET;
if (!rawUrl) {
  process.stderr.write(`${environmentName} is required.\n`);
  process.exit(1);
}
let databaseUrl;
try {
  databaseUrl = new URL(rawUrl);
} catch {
  process.stderr.write(`${environmentName} is invalid.\n`);
  process.exit(1);
}
if (!['mariadb:', 'mysql:'].includes(databaseUrl.protocol)) {
  process.stderr.write(`${environmentName} must use MariaDB or MySQL.\n`);
  process.exit(1);
}
if (
  databaseUrl.hostname !== 'localhost' ||
  databaseUrl.port
) {
  process.stderr.write(
    `${environmentName} must be socket-only (localhost with no TCP port).\n`,
  );
  process.exit(1);
}
if (
  !socketPath ||
  !socketPath.startsWith('/') ||
  socketPath === '/' ||
  /[\r\n\0]/.test(socketPath)
) {
  process.stderr.write(
    'CH_CORE_MARIADB_SOCKET must be a safe absolute socket path.\n',
  );
  process.exit(1);
}
let username;
let password;
try {
  username = decodeURIComponent(databaseUrl.username);
  password = decodeURIComponent(databaseUrl.password);
} catch {
  process.stderr.write(`${environmentName} contains an unsafe value.\n`);
  process.exit(1);
}
const values = [
  socketPath,
  username,
  password,
];
if (values.some((value) => !value || /[\r\n\0]/.test(value))) {
  process.stderr.write(`${environmentName} contains an unsafe value.\n`);
  process.exit(1);
}
const quoteValue = (value) =>
  `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
const contents = [
  '[client]',
  'protocol="socket"',
  `socket=${quoteValue(socketPath)}`,
  `user=${quoteValue(username)}`,
  `password=${quoteValue(password)}`,
  '',
].join('\n');
fs.writeFileSync(target, contents, { mode: 0o600 });
NODE
}

database_name() {
  database_env_name=$1
  database_role=$2
  node --input-type=module - "$database_env_name" "$database_role" <<'NODE'
const [environmentName, role] = process.argv.slice(2);
const rawUrl = process.env[environmentName];
if (!rawUrl) {
  process.stderr.write(`${environmentName} is required.\n`);
  process.exit(1);
}
let databaseUrl;
try {
  databaseUrl = new URL(rawUrl);
} catch {
  process.stderr.write(`${environmentName} is invalid.\n`);
  process.exit(1);
}
let name;
try {
  name = decodeURIComponent(databaseUrl.pathname.slice(1));
} catch {
  process.stderr.write(`${environmentName} database name is unsafe.\n`);
  process.exit(1);
}
const valid =
  role === 'backup'
    ? name === 'chu'
    : /^chu_restore_[a-z0-9_]+$/.test(name);
if (!valid) {
  process.stderr.write(
    role === 'backup'
      ? `${environmentName} must target /chu.\n`
      : `${environmentName} must target /chu_restore_[a-z0-9_]+.\n`,
  );
  process.exit(1);
}
process.stdout.write(name);
NODE
}

database_binary() {
  binary_env_name=$1
  default_binary=$2
  case "$binary_env_name" in
    CH_CORE_MARIADB_BIN)
      binary=${CH_CORE_MARIADB_BIN:-$default_binary}
      ;;
    CH_CORE_MARIADB_DUMP_BIN)
      binary=${CH_CORE_MARIADB_DUMP_BIN:-$default_binary}
      ;;
    *)
      die 'Unsupported database binary environment variable.'
      ;;
  esac
  case "$binary" in
    ''|*[!A-Za-z0-9_./-]*)
      die "$binary_env_name contains an unsafe value."
      ;;
  esac
  command -v "$binary" >/dev/null 2>&1 ||
    die "$binary_env_name executable is unavailable."
  printf '%s\n' "$binary"
}

sha256_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    die 'A SHA-256 utility is required.'
  fi
}
