from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import text

from app.api.deps import DbSession
from app.core.config import settings
from app.schemas.common import AccountType, ExpenseStatus, IncomeStatus, Recurrence

router = APIRouter(tags=["meta"])


class AppConfig(BaseModel):
    app_name: str
    base_currency: str
    supported_currencies: list[str]
    account_types: list[str]
    expense_statuses: list[str]
    income_statuses: list[str]
    recurrences: list[str]
    # 0 means the background loop is off and refreshing is manual.
    news_refresh_minutes: int


class Health(BaseModel):
    status: str
    database: str


@router.get("/config", response_model=AppConfig)
def app_config() -> AppConfig:
    """Everything the frontend needs to build its dropdowns without hardcoding."""
    return AppConfig(
        app_name=settings.app_name,
        base_currency=settings.base_currency,
        supported_currencies=sorted(settings.currency_set),
        account_types=[t.value for t in AccountType],
        expense_statuses=[s.value for s in ExpenseStatus],
        income_statuses=[s.value for s in IncomeStatus],
        recurrences=[r.value for r in Recurrence],
        news_refresh_minutes=settings.news_refresh_minutes,
    )


@router.get("/health", response_model=Health)
def health(db: DbSession) -> Health:
    try:
        db.execute(text("SELECT 1"))
        database = "ok"
    except Exception as exc:  # noqa: BLE001 - surfaced verbatim to the operator
        database = f"error: {exc.__class__.__name__}"
    return Health(status="ok", database=database)
