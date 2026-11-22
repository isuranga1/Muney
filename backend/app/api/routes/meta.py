from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import text

from app.api.deps import CurrentUser, DbSession
from app.core.config import settings
from app.schemas.common import AccountType
from app.services import llm

router = APIRouter(tags=["meta"])


class AppConfig(BaseModel):
    app_name: str
    base_currency: str
    # Second display currency (USD by default), or null when turned off.
    secondary_currency: str | None
    supported_currencies: list[str]
    account_types: list[str]
    # 0 means the background loop is off and refreshing is manual.
    news_refresh_minutes: int
    ingest_enabled: bool
    # none | anthropic | llamacpp
    llm_provider: str
    llm_model: str | None


class Health(BaseModel):
    status: str
    database: str


@router.get("/config", response_model=AppConfig)
def app_config() -> AppConfig:
    """Everything the frontend needs to build its dropdowns without hardcoding."""
    return AppConfig(
        app_name=settings.app_name,
        base_currency=settings.base_currency,
        secondary_currency=settings.secondary_currency or None,
        supported_currencies=sorted(settings.currency_set),
        account_types=[t.value for t in AccountType],
        news_refresh_minutes=settings.news_refresh_minutes,
        ingest_enabled=bool(settings.ingest_token),
        llm_provider=settings.llm_provider,
        llm_model=llm.model_name() or None,
    )


@router.get("/health", response_model=Health)
def health(db: DbSession) -> Health:
    try:
        db.execute(text("SELECT 1"))
        database = "ok"
    except Exception as exc:  # noqa: BLE001 - surfaced verbatim to the operator
        database = f"error: {exc.__class__.__name__}"
    return Health(status="ok", database=database)


class LlmStatus(BaseModel):
    provider: str
    model: str | None
    ready: bool
    detail: str | None


@router.get("/llm/status", response_model=LlmStatus)
def llm_status(current_user: CurrentUser) -> LlmStatus:
    """Whether the SMS-reading model is downloaded and loaded."""
    return LlmStatus(**llm.status())
