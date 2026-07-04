#!/usr/bin/env bash
# Restores a gzip-compressed pg_dump produced by backup-db.sh into the target database.
# Destructive: prompts for confirmation before overwriting existing data.
#
# Usage:
#   infra/scripts/restore-db.sh <path-to-dump.sql.gz> [--yes]
#
# Env vars: POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, POSTGRES_PORT (same as backup-db.sh)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

DUMP_FILE="${1:-}"
CONFIRM_FLAG="${2:-}"

if [ -z "$DUMP_FILE" ] || [ ! -f "$DUMP_FILE" ]; then
  echo "Usage: $0 <path-to-dump.sql.gz> [--yes]" >&2
  echo "Dump file not found: ${DUMP_FILE:-<missing>}" >&2
  exit 1
fi

# Preserve any of these already exported by the caller — .env is a fallback, not an override.
CALLER_POSTGRES_USER="${POSTGRES_USER:-}"
CALLER_POSTGRES_DB="${POSTGRES_DB:-}"
CALLER_POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-}"
CALLER_POSTGRES_PORT="${POSTGRES_PORT:-}"

if [ -f "$REPO_ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.env"
  set +a
fi

POSTGRES_USER="${CALLER_POSTGRES_USER:-${POSTGRES_USER:-bmp}}"
POSTGRES_DB="${CALLER_POSTGRES_DB:-${POSTGRES_DB:-bmp}}"
POSTGRES_PASSWORD="${CALLER_POSTGRES_PASSWORD:-${POSTGRES_PASSWORD:-}}"
POSTGRES_PORT="${CALLER_POSTGRES_PORT:-${POSTGRES_PORT:-5432}}"

if [ "$CONFIRM_FLAG" != "--yes" ]; then
  read -r -p "This will OVERWRITE all data in database '$POSTGRES_DB'. Type the database name to confirm: " CONFIRM
  if [ "$CONFIRM" != "$POSTGRES_DB" ]; then
    echo "Confirmation did not match. Aborted."
    exit 1
  fi
fi

echo "Restoring $DUMP_FILE into '$POSTGRES_DB' ..."

if docker compose -f "$REPO_ROOT/docker-compose.yml" ps postgres >/dev/null 2>&1 \
  && [ "$(docker compose -f "$REPO_ROOT/docker-compose.yml" ps -q postgres)" != "" ]; then
  gunzip -c "$DUMP_FILE" | docker compose -f "$REPO_ROOT/docker-compose.yml" exec -T postgres \
    psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" --single-transaction --set ON_ERROR_STOP=on
else
  gunzip -c "$DUMP_FILE" | PGPASSWORD="${POSTGRES_PASSWORD:-}" psql \
    -h "${POSTGRES_HOST:-localhost}" -p "${POSTGRES_PORT:-5432}" \
    -U "$POSTGRES_USER" -d "$POSTGRES_DB" --single-transaction --set ON_ERROR_STOP=on
fi

echo "Restore complete."
