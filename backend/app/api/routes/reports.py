from datetime import date

from fastapi import APIRouter, Query

from app.api.deps import CurrentUser, DbSession
from app.schemas.finance import MonthReport, YearReport
from app.services import reports

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/month", response_model=MonthReport)
def month(
    db: DbSession,
    current_user: CurrentUser,
    year: int | None = Query(default=None, ge=1970, le=2999),
    month: int | None = Query(default=None, ge=1, le=12),
) -> MonthReport:
    today = date.today()
    return reports.month_report(db, year or today.year, month or today.month)


@router.get("/year", response_model=YearReport)
def year(
    db: DbSession,
    current_user: CurrentUser,
    year: int | None = Query(default=None, ge=1970, le=2999),
) -> YearReport:
    return reports.year_report(db, year or date.today().year)
