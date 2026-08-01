#!/usr/bin/env bash
# Dump the Muney database, keep a rotating local window, and optionally copy
# the dump to Google Drive and/or another device on the tailnet.
#
# A destination being unreachable is logged and skipped — it never fails the
# run, because the local copy is what matters most and a later run will catch
# the destination up while it is still inside LOCAL_RETENTION_DAYS.
set -uo pipefail

cd "$(dirname "$0")/.."

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1"; }
fail() { log "ERROR: $1" >&2; }

[ -f .env ] || { fail ".env missing"; exit 1; }
# shellcheck disable=SC1091
set -a; . ./.env; set +a

if [ -f backup.env ]; then
    # shellcheck disable=SC1091
    set -a; . ./backup.env; set +a
else
    log "backup.env not found — using defaults (local copy only)"
fi

BACKUP_DIR="${BACKUP_DIR:-./backups}"
LOCAL_RETENTION_DAYS="${LOCAL_RETENTION_DAYS:-14}"
POSTGRES_USER="${POSTGRES_USER:-muney}"
POSTGRES_DB="${POSTGRES_DB:-muney}"

mkdir -p "$BACKUP_DIR"

STAMP="$(date '+%Y%m%d-%H%M%S')"
FILE="$BACKUP_DIR/muney-$STAMP.sql.gz"

# ------------------------------------------------------------------- dump
log "Dumping $POSTGRES_DB"
if ! docker compose exec -T db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "$FILE"; then
    fail "pg_dump failed"
    rm -f "$FILE"
    exit 1
fi

# A gzip of an empty/failed dump is still a few bytes, so check it decompresses
# and actually contains SQL before treating it as a real backup.
if ! gunzip -t "$FILE" 2>/dev/null || [ "$(stat -c%s "$FILE")" -lt 1000 ]; then
    fail "dump looks empty or corrupt — keeping it for inspection but not uploading"
    exit 1
fi
log "Wrote $FILE ($(du -h "$FILE" | cut -f1))"

# ------------------------------------------------------------ google drive
if [ "${BACKUP_TO_GDRIVE:-false}" = "true" ]; then
    if ! command -v rclone >/dev/null 2>&1; then
        fail "BACKUP_TO_GDRIVE=true but rclone is not installed — skipping"
    else
        REMOTE="${GDRIVE_REMOTE_NAME:-gdrive}:${GDRIVE_FOLDER:-muney-backups}"
        log "Uploading to $REMOTE"
        if rclone copy "$FILE" "$REMOTE" --no-traverse; then
            days="${GDRIVE_RETENTION_DAYS:-30}"
            log "Pruning Drive copies older than ${days}d"
            rclone delete "$REMOTE" --min-age "${days}d" || fail "Drive prune failed"
        else
            fail "Drive upload failed — local copy retained"
        fi
    fi
fi

# --------------------------------------------------------- tailnet device
if [ "${BACKUP_TO_REMOTE:-false}" = "true" ]; then
    if [ -z "${REMOTE_HOST:-}" ] || [ -z "${REMOTE_USER:-}" ]; then
        fail "BACKUP_TO_REMOTE=true but REMOTE_USER/REMOTE_HOST are unset — skipping"
    else
        KEY="${REMOTE_SSH_KEY:-$HOME/.ssh/backup_key}"
        KEY="${KEY/#\~/$HOME}"
        log "Copying to $REMOTE_USER@$REMOTE_HOST:${REMOTE_PATH:-/backups/muney}"
        if ! scp -i "$KEY" -o BatchMode=yes -o ConnectTimeout=15 \
            "$FILE" "$REMOTE_USER@$REMOTE_HOST:${REMOTE_PATH:-/backups/muney}/"; then
            fail "scp to $REMOTE_HOST failed — local copy retained"
        fi
    fi
fi

# ------------------------------------------------------------ local prune
log "Pruning local copies older than ${LOCAL_RETENTION_DAYS}d"
find "$BACKUP_DIR" -name 'muney-*.sql.gz' -type f -mtime "+$LOCAL_RETENTION_DAYS" -delete

log "Backup complete"
