#!/bin/sh
set -eu

health_url=${1:-http://127.0.0.1:18080/health/ready}
node --input-type=module - "$health_url" <<'NODE'
const url = process.argv[2];
try {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) process.exit(1);
  const body = await response.json();
  if (body.status !== 'ok') process.exit(1);
} catch {
  process.exit(1);
}
NODE
