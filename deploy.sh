#!/usr/bin/env bash
# Pull the latest main and redeploy. Safe to run repeatedly.
#
#   ./deploy.sh          rebuild whatever changed and restart
#   ./deploy.sh --no-pull  redeploy the working tree as-is (skip git)
#
# Database migrations run automatically inside the backend container on start
# (see backend/entrypoint.sh) — there is no separate migration step.
set -euo pipefail

cd "$(dirname "$0")"

BRANCH="${DEPLOY_BRANCH:-main}"
PULL=1
[ "${1:-}" = "--no-pull" ] && PULL=0

log() { printf '\n\033[1;34m==>\033[0m %s\n' "$1"; }

if [ ! -f .env ]; then
    echo "ERROR: .env is missing. Copy .env.example to .env and fill it in." >&2
    exit 1
fi

if [ "$PULL" -eq 1 ]; then
    log "Fetching origin/$BRANCH"
    git fetch --prune origin
    # Hard reset rather than merge: the Pi is a deployment target, not a place
    # where edits are made, so local drift should always lose.
    git reset --hard "origin/$BRANCH"
fi

log "Building images"
docker compose build

log "Starting services"
docker compose up -d --remove-orphans

log "Waiting for the backend to report healthy"
for _ in $(seq 1 60); do
    state="$(docker compose ps --format json backend 2>/dev/null | grep -o '"Health":"[a-z]*"' | head -1 || true)"
    case "$state" in
        *healthy*) break ;;
    esac
    sleep 2
done

log "Status"
docker compose ps

log "Pruning dangling images"
docker image prune -f >/dev/null

WEB_PORT="$(grep -E '^MUNEY_WEB_PORT=' .env | cut -d= -f2 || true)"
WEB_PORT="${WEB_PORT:-8080}"
log "Done. Muney is on http://$(hostname):${WEB_PORT} (and your tailnet address)"
