#!/bin/sh
set -eu

die() {
  printf '%s\n' "$1" >&2
  exit 1
}

require_database_url() {
  [ -n "${CH_CORE_DATABASE_URL:-}" ] ||
    die 'CH_CORE_DATABASE_URL is required.'
}

write_client_defaults() {
  defaults_path=$1
  require_database_url
  node --input-type=module - "$defaults_path" <<'NODE'
import fs from 'node:fs';

const target = process.argv[2];
let databaseUrl;
try {
  databaseUrl = new URL(process.env.CH_CORE_DATABASE_URL);
} catch {
  process.stderr.write('CH_CORE_DATABASE_URL is invalid.\n');
  process.exit(1);
}
if (!['mariadb:', 'mysql:'].includes(databaseUrl.protocol)) {
  process.stderr.write('CH_CORE_DATABASE_URL must use MariaDB or MySQL.\n');
  process.exit(1);
}
let username;
let password;
try {
  username = decodeURIComponent(databaseUrl.username);
  password = decodeURIComponent(databaseUrl.password);
} catch {
  process.stderr.write('CH_CORE_DATABASE_URL contains an unsafe value.\n');
  process.exit(1);
}
const values = [
  databaseUrl.hostname,
  username,
  password,
  databaseUrl.port || '3306',
];
if (values.some((value) => !value || /[\r\n\0]/.test(value))) {
  process.stderr.write('CH_CORE_DATABASE_URL contains an unsafe value.\n');
  process.exit(1);
}
const escapeValue = (value) => value.replaceAll('\\', '\\\\');
const contents = [
  '[client]',
  `host=${escapeValue(databaseUrl.hostname)}`,
  `port=${escapeValue(databaseUrl.port || '3306')}`,
  `user=${escapeValue(username)}`,
  `password=${escapeValue(password)}`,
  '',
].join('\n');
fs.writeFileSync(target, contents, { mode: 0o600 });
NODE
}

database_name() {
  require_database_url
  node --input-type=module <<'NODE'
let databaseUrl;
try {
  databaseUrl = new URL(process.env.CH_CORE_DATABASE_URL);
} catch {
  process.exit(1);
}
const name = decodeURIComponent(databaseUrl.pathname.slice(1));
if (!/^[A-Za-z0-9_]+$/.test(name)) process.exit(1);
process.stdout.write(name);
NODE
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
