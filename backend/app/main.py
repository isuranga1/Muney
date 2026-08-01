import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.db.session import SessionLocal
from app.api.routes import auth, banks, dashboard, expenses, fx, income, meta
from app.services.fx import refresh_if_stale

logger = logging.getLogger("muney")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Warm the FX cache once at boot so the first dashboard load already converts.
    try:
        with SessionLocal() as db:
            if refresh_if_stale(db):
                logger.info("FX rates refreshed at startup")
    except Exception as exc:  # noqa: BLE001 - never block startup on rates or a cold DB
        logger.warning("Skipped FX warm-up: %s", exc)
    yield


app = FastAPI(
    title=f"{settings.app_name} API",
    description="Personal finance board — banks, accounts, expenses and income.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for module in (meta, auth, banks, expenses, income, fx, dashboard):
    app.include_router(module.router, prefix=settings.api_prefix)


@app.get("/")
def root() -> dict[str, str]:
    return {"app": settings.app_name, "docs": "/docs", "api": settings.api_prefix}
