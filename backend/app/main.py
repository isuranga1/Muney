import asyncio
import logging
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import auth, banks, dashboard, expenses, fx, income, meta, news
from app.core.config import settings
from app.db.session import SessionLocal
from app.services import rss
from app.services.fx import refresh_if_stale

logger = logging.getLogger("muney")


def _refresh_news_once() -> None:
    """One blocking refresh pass. Runs in a worker thread, never on the loop."""
    with SessionLocal() as db:
        result = rss.refresh_all(db)
        rss.prune_old_articles(db)
        if result["feeds"]:
            logger.info(
                "News refresh: %s feeds, %s new articles",
                result["feeds"],
                result["new_articles"],
            )


async def _news_refresh_loop() -> None:
    """Keep feeds current without anyone pressing a button.

    Deliberately a plain task rather than a scheduler dependency: one interval,
    no persistence needed, and it dies cleanly with the app. A failure here is
    logged and retried next tick — it must never take the API down with it.
    """
    # Small delay so startup is not competing with the first requests.
    await asyncio.sleep(20)
    interval = settings.news_refresh_minutes * 60
    while True:
        try:
            await asyncio.to_thread(_refresh_news_once)
        except Exception as exc:  # noqa: BLE001 - a bad feed must not kill the loop
            logger.warning("News refresh failed: %s", exc)
        await asyncio.sleep(interval)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Warm the FX cache once at boot so the first dashboard load already converts.
    try:
        with SessionLocal() as db:
            if refresh_if_stale(db):
                logger.info("FX rates refreshed at startup")
    except Exception as exc:  # noqa: BLE001 - never block startup on rates or a cold DB
        logger.warning("Skipped FX warm-up: %s", exc)

    task: asyncio.Task | None = None
    if settings.news_refresh_minutes > 0:
        task = asyncio.create_task(_news_refresh_loop())
        logger.info("News auto-refresh every %s min", settings.news_refresh_minutes)

    yield

    if task is not None:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


app = FastAPI(
    title=f"{settings.app_name} API",
    description="Personal finance board — banks, accounts, expenses, income and news.",
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

for module in (meta, auth, banks, expenses, income, news, fx, dashboard):
    app.include_router(module.router, prefix=settings.api_prefix)


@app.get("/")
def root() -> dict[str, str]:
    return {"app": settings.app_name, "docs": "/docs", "api": settings.api_prefix}
