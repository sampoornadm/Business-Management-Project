#!/usr/bin/env bash
# Dumps the Postgres database to a timestamped, gzip-compressed file and prunes dumps
# older than BACKUP_RETENTION_DAYS. Works both against the docker-compose "postgres"
# service and a bare `pg_dump` on PATH — whichever is available.
#
# Usage:
#   infra/scripts/backup-db.sh [output-dir]
#
# Env vars (read from .env if present, or the shell environment):
#   POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, POSTGRES_PORT
#   BACKUP_RETENTION_DAYS (default: 14)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

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
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
OUTPUT_DIR="${1:-$REPO_ROOT/backups}"

mkdir -p "$OUTPUT_DIR"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP_FILE="$OUTPUT_DIR/${POSTGRES_DB}-${TIMESTAMP}.sql.gz"

echo "Backing up database '$POSTGRES_DB' to $DUMP_FILE ..."

if docker compose -f "$REPO_ROOT/docker-compose.yml" ps postgres >/dev/null 2>&1 \
  && [ "$(docker compose -f "$REPO_ROOT/docker-compose.yml" ps -q postgres)" != "" ]; then
  docker compose -f "$REPO_ROOT/docker-compose.yml" exec -T postgres \
    pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges \
    | gzip > "$DUMP_FILE"
else
  PGPASSWORD="${POSTGRES_PASSWORD:-}" pg_dump \
    -h "${POSTGRES_HOST:-localhost}" -p "${POSTGRES_PORT:-5432}" \
    -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges \
    | gzip > "$DUMP_FILE"
fi

echo "Backup written: $DUMP_FILE ($(du -h "$DUMP_FILE" | cut -f1))"

echo "Pruning dumps older than $BACKUP_RETENTION_DAYS days ..."
find "$OUTPUT_DIR" -name "${POSTGRES_DB}-*.sql.gz" -type f -mtime "+$BACKUP_RETENTION_DAYS" -print -delete

echo "Done."
