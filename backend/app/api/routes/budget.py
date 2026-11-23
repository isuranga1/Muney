from datetime import date
from decimal import Decimal

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.deps import CurrentUser, DbSession
from app.models import BudgetBucket, BudgetMonth, FundEntry
from app.schemas.finance import (
    AllocationSet,
    BucketCreate,
    BucketRead,
    BucketUpdate,
    BudgetBasisSet,
    BudgetMonthStatus,
    FundAdjust,
    FundEntryRead,
    FundsOverview,
)
from app.services import reports
from app.services.fx import convert, get_rate_map

router = APIRouter(prefix="/budget", tags=["budget"])


def _get(db: DbSession, bucket_id: int) -> BudgetBucket:
    bucket = db.get(BudgetBucket, bucket_id)
    if bucket is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bucket not found")
    return bucket


def _commit(db: DbSession) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="A bucket with that name already exists"
        ) from exc


@router.get("/buckets", response_model=list[BucketRead])
def list_buckets(db: DbSession, current_user: CurrentUser) -> list[BudgetBucket]:
    return list(db.scalars(select(BudgetBucket).order_by(BudgetBucket.sort_order)).all())


@router.post("/buckets", response_model=BucketRead, status_code=status.HTTP_201_CREATED)
def create_bucket(payload: BucketCreate, db: DbSession, current_user: CurrentUser) -> BudgetBucket:
    bucket = BudgetBucket(**payload.model_dump())
    db.add(bucket)
    _commit(db)
    db.refresh(bucket)
    return bucket


@router.patch("/buckets/{bucket_id}", response_model=BucketRead)
def update_bucket(
    bucket_id: int, payload: BucketUpdate, db: DbSession, current_user: CurrentUser
) -> BudgetBucket:
    bucket = _get(db, bucket_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(bucket, field, value)
    _commit(db)
    db.refresh(bucket)
    return bucket


@router.delete("/buckets/{bucket_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_bucket(bucket_id: int, db: DbSession, current_user: CurrentUser) -> Response:
    """Categories and accounts mapped to it become unassigned."""
    db.delete(_get(db, bucket_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/month", response_model=BudgetMonthStatus)
def month_status(
    db: DbSession,
    current_user: CurrentUser,
    year: int | None = Query(default=None, ge=1970, le=2999),
    month: int | None = Query(default=None, ge=1, le=12),
) -> BudgetMonthStatus:
    today = date.today()
    return reports.budget_status(db, year or today.year, month or today.month)


@router.put("/month/{year}/{month}/basis", response_model=BudgetMonthStatus)
def set_basis(
    year: int, month: int, payload: BudgetBasisSet, db: DbSession, current_user: CurrentUser
) -> BudgetMonthStatus:
    if not 1 <= month <= 12:
        raise HTTPException(status_code=422, detail="month must be 1-12")
    row = db.scalar(select(BudgetMonth).where(BudgetMonth.year == year, BudgetMonth.month == month))
    if payload.income_basis is None:
        if row is not None:
            db.delete(row)
    elif row is None:
        db.add(BudgetMonth(year=year, month=month, income_basis=payload.income_basis))
    else:
        row.income_basis = payload.income_basis
    db.commit()
    return reports.budget_status(db, year, month)


@router.get("/history", response_model=list[BudgetMonthStatus])
def history(
    db: DbSession, current_user: CurrentUser, months: int = Query(default=12, ge=1, le=36)
) -> list[BudgetMonthStatus]:
    """The last N months, newest first — "did I hit my rule each month?"."""
    year, month = date.today().year, date.today().month
    out = []
    for _ in range(months):
        out.append(reports.budget_status(db, year, month))
        year, month = reports.previous_month(year, month)
    return out


# -------------------------------------------------------------------- funds


def _base_value(db: DbSession, amount: Decimal, currency: str) -> Decimal:
    """Frozen at today's rate, like a transaction's base_amount."""
    value = convert(amount, currency, get_rate_map(db))
    if value is None:
        raise HTTPException(
            status_code=422,
            detail=f"No exchange rate for {currency} yet — refresh rates or set one in Settings",
        )
    return value


def _month_date(year: int, month: int) -> date:
    """Today if it's that month; otherwise the month's last (or first) day."""
    start, end = reports.month_bounds(year, month)
    return min(max(date.today(), start), end)


@router.put("/allocations/{bucket_id}/{year}/{month}", response_model=BudgetMonthStatus)
def set_allocation(
    bucket_id: int,
    year: int,
    month: int,
    payload: AllocationSet,
    db: DbSession,
    current_user: CurrentUser,
) -> BudgetMonthStatus:
    """Tick a saving bucket for the month: this much is set aside, wherever it sits."""
    if not 1 <= month <= 12:
        raise HTTPException(status_code=422, detail="month must be 1-12")
    if _get(db, bucket_id).goal_type != "save":
        raise HTTPException(status_code=422, detail="Only saving buckets take allocations")
    entry = db.scalar(
        select(FundEntry).where(
            FundEntry.bucket_id == bucket_id,
            FundEntry.kind == "monthly",
            FundEntry.year == year,
            FundEntry.month == month,
        )
    )
    if entry is None:
        entry = FundEntry(bucket_id=bucket_id, kind="monthly", year=year, month=month)
        db.add(entry)
    entry.entry_date = _month_date(year, month)
    entry.amount = payload.amount
    entry.currency = payload.currency
    entry.base_amount = _base_value(db, payload.amount, payload.currency)
    entry.note = payload.note
    db.commit()
    return reports.budget_status(db, year, month)


@router.delete("/allocations/{bucket_id}/{year}/{month}", response_model=BudgetMonthStatus)
def clear_allocation(
    bucket_id: int, year: int, month: int, db: DbSession, current_user: CurrentUser
) -> BudgetMonthStatus:
    entry = db.scalar(
        select(FundEntry).where(
            FundEntry.bucket_id == bucket_id,
            FundEntry.kind == "monthly",
            FundEntry.year == year,
            FundEntry.month == month,
        )
    )
    if entry is not None:
        db.delete(entry)
        db.commit()
    return reports.budget_status(db, year, month)


@router.get("/funds", response_model=FundsOverview)
def funds(db: DbSession, current_user: CurrentUser) -> FundsOverview:
    return reports.fund_overview(db)


@router.get("/funds/{bucket_id}/entries", response_model=list[FundEntryRead])
def fund_entries(bucket_id: int, db: DbSession, current_user: CurrentUser) -> list[FundEntry]:
    _get(db, bucket_id)
    return list(
        db.scalars(
            select(FundEntry)
            .where(FundEntry.bucket_id == bucket_id)
            .order_by(FundEntry.entry_date.desc(), FundEntry.id.desc())
        ).all()
    )


@router.post(
    "/funds/{bucket_id}/entries", response_model=FundEntryRead, status_code=status.HTTP_201_CREATED
)
def add_fund_entry(
    bucket_id: int, payload: FundAdjust, db: DbSession, current_user: CurrentUser
) -> FundEntry:
    """An opening balance or top-up, or (negative) money taken out of the fund."""
    _get(db, bucket_id)
    if payload.amount == 0:
        raise HTTPException(status_code=422, detail="Amount can't be zero")
    when = payload.entry_date or date.today()
    entry = FundEntry(
        bucket_id=bucket_id,
        kind="adjust",
        year=when.year,
        month=when.month,
        entry_date=when,
        amount=payload.amount,
        currency=payload.currency,
        base_amount=_base_value(db, payload.amount, payload.currency),
        note=payload.note,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@router.delete("/funds/entries/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_fund_entry(entry_id: int, db: DbSession, current_user: CurrentUser) -> Response:
    entry = db.get(FundEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entry not found")
    db.delete(entry)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
