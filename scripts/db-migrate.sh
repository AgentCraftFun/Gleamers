#!/usr/bin/env bash
# Apply Supabase SQL migrations against SUPABASE_DB_URL.
#
#   SUPABASE_DB_URL="postgres://..." pnpm db:migrate
#
# For hosted Supabase, use the Postgres connection string from the
# project's Database settings. For local Supabase CLI, use the local
# Postgres URL (typically postgresql://postgres:postgres@localhost:54322/postgres).
set -euo pipefail

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "ERROR: SUPABASE_DB_URL is not set." >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: psql is required on PATH." >&2
  exit 1
fi

cd "$(dirname "$0")/.."
migrations=(supabase/migrations/*.sql)

echo "[migrate] applying ${#migrations[@]} migration(s)"
for f in "${migrations[@]}"; do
  echo "[migrate] -> $f"
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$f"
done
echo "[migrate] done"
