#!/bin/sh
# Applies any pending migrations, then serves the API. Safe to run on every
# container start: `alembic upgrade head` is a no-op when already current.
set -e

echo "[muney] waiting for postgres..."
python - <<'PY'
import os, sys, time
from sqlalchemy import create_engine, text

url = os.environ["DATABASE_URL"]
deadline = time.time() + 90
last = None
while time.time() < deadline:
    try:
        create_engine(url, pool_pre_ping=True).connect().execute(text("SELECT 1"))
        print("[muney] postgres is up")
        sys.exit(0)
    except Exception as exc:  # noqa: BLE001 - any failure means "not ready yet"
        last = exc
        time.sleep(2)
print(f"[muney] database never became reachable: {last}", file=sys.stderr)
sys.exit(1)
PY

echo "[muney] applying migrations..."
alembic upgrade head

echo "[muney] starting api on :8000"
# proxy-headers so the app sees the real scheme/host through nginx.
exec uvicorn app.main:app \
    --host 0.0.0.0 \
    --port 8000 \
    --proxy-headers \
    --forwarded-allow-ips='*'
