"""Create the Muney database if it does not exist yet.

Run from the backend/ directory once, before the first `alembic upgrade head`:

    .venv\\Scripts\\python scripts/create_db.py
"""

import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

import psycopg  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402

from app.core.config import settings  # noqa: E402


def main() -> int:
    url = make_url(settings.database_url)
    target = url.database
    if not target:
        print("DATABASE_URL has no database name.", file=sys.stderr)
        return 1

    # Connect to the always-present maintenance database to issue CREATE DATABASE.
    conninfo = {
        "host": url.host or "localhost",
        "port": url.port or 5432,
        "user": url.username or "postgres",
        "dbname": "postgres",
    }
    if url.password:
        conninfo["password"] = url.password

    try:
        with psycopg.connect(**conninfo, autocommit=True) as conn:
            exists = conn.execute(
                "SELECT 1 FROM pg_database WHERE datname = %s", (target,)
            ).fetchone()
            if exists:
                print(f"Database {target!r} already exists.")
                return 0
            # Identifiers cannot be parameterised; quote it instead.
            conn.execute(f'CREATE DATABASE "{target}"')
            print(f"Created database {target!r}.")
            return 0
    except psycopg.OperationalError as exc:
        print(f"Could not connect to PostgreSQL: {exc}", file=sys.stderr)
        print("Check DATABASE_URL in backend/.env (host, port, user, password).", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
