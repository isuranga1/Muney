from datetime import date
from decimal import Decimal

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError

from app.api.deps import CurrentUser, DbSession
from app.core.config import settings
from app.models import BudgetBucket, BudgetMonth, FundMove
from app.schemas.finance import (
    BucketCreate,
    BucketRead,
    BucketUpdate,
    BudgetBasisSet,
    BudgetMonthStatus,
    FundMoveCreate,
    FundMoveRead,
    FundsOverview,
)
from app.services import reports
from app.services.fx import convert, get_rate_map, quantize_money

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


# ------------------------------------------------------------------ the rule
#
# Every change to the rule first pins finished months to the percentages they
# had, so a change applies from this month on and past balances don't move.


@router.get("/buckets", response_model=list[BucketRead])
def list_buckets(db: DbSession, current_user: CurrentUser) -> list[BudgetBucket]:
    return list(db.scalars(select(BudgetBucket).order_by(BudgetBucket.sort_order)).all())


@router.post("/buckets", response_model=BucketRead, status_code=status.HTTP_201_CREATED)
def create_bucket(payload: BucketCreate, db: DbSession, current_user: CurrentUser) -> BudgetBucket:
    reports.freeze_past_shares(db)
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
    data = payload.model_dump(exclude_unset=True)
    if "percent" in data and Decimal(data["percent"]) != Decimal(bucket.percent):
        reports.freeze_past_shares(db)
    for field, value in data.items():
        setattr(bucket, field, value)
    _commit(db)
    db.refresh(bucket)
    return bucket


@router.delete("/buckets/{bucket_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_bucket(
    bucket_id: int,
    db: DbSession,
    current_user: CurrentUser,
    move_to: int | None = Query(default=None, description="Bucket that takes over its balance"),
) -> Response:
    """Categories mapped to it become unassigned.

    With `move_to`, whatever it holds goes to that bucket first (or, if it's
    overspent, that bucket covers the gap). Without it, the balance is dropped.
    """
    bucket = _get(db, bucket_id)
    if move_to is not None:
        if move_to == bucket_id:
            raise HTTPException(status_code=422, detail="Pick a different bucket")
        _get(db, move_to)
        balance = quantize_money(reports.Ledger(db).balance(bucket_id))
        if balance != 0:
            db.add(
                FundMove(
                    moved_on=date.today(),
                    from_bucket_id=bucket_id if balance > 0 else move_to,
                    to_bucket_id=move_to if balance > 0 else bucket_id,
                    amount=abs(balance),
                    note=f"Balance of {bucket.name}, removed",
                )
            )
    reports.freeze_past_shares(db)
    db.delete(bucket)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------- the months


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
    """The last N months, newest first."""
    return reports.budget_history(db, months)


# --------------------------------------------------------------------- funds


@router.get("/funds", response_model=FundsOverview)
def funds(db: DbSession, current_user: CurrentUser) -> FundsOverview:
    return reports.fund_overview(db)


@router.get("/moves", response_model=list[FundMoveRead])
def list_moves(
    db: DbSession,
    current_user: CurrentUser,
    bucket_id: int | None = None,
    limit: int = Query(default=100, ge=1, le=500),
) -> list[FundMove]:
    stmt = select(FundMove).order_by(FundMove.moved_on.desc(), FundMove.id.desc()).limit(limit)
    if bucket_id is not None:
        stmt = stmt.where(
            or_(FundMove.from_bucket_id == bucket_id, FundMove.to_bucket_id == bucket_id)
        )
    return list(db.scalars(stmt).all())


@router.post("/moves", response_model=FundMoveRead, status_code=status.HTTP_201_CREATED)
def create_move(payload: FundMoveCreate, db: DbSession, current_user: CurrentUser) -> FundMove:
    """Cover one bucket from another, or add money to / take it out of one."""
    if payload.from_bucket_id is None and payload.to_bucket_id is None:
        raise HTTPException(status_code=422, detail="Pick at least one bucket")
    if payload.from_bucket_id == payload.to_bucket_id:
        raise HTTPException(status_code=422, detail="Pick two different buckets")
    for bucket_id in (payload.from_bucket_id, payload.to_bucket_id):
        if bucket_id is not None:
            _get(db, bucket_id)

    base = settings.base_currency
    currency = payload.currency or base
    amount = Decimal(payload.amount)
    note = payload.note
    if currency != base:
        converted = convert(amount, currency, get_rate_map(db))
        if converted is None:
            raise HTTPException(
                status_code=422,
                detail=f"No exchange rate for {currency} yet — refresh rates in Settings",
            )
        original = f"{currency} {amount:,.2f}"
        note = f"{note} ({original})" if note else original
        amount = converted

    move = FundMove(
        moved_on=payload.moved_on or date.today(),
        from_bucket_id=payload.from_bucket_id,
        to_bucket_id=payload.to_bucket_id,
        amount=quantize_money(amount),
        note=note[:200] if note else None,
    )
    db.add(move)
    db.commit()
    db.refresh(move)
    return move


@router.delete("/moves/{move_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_move(move_id: int, db: DbSession, current_user: CurrentUser) -> Response:
    move = db.get(FundMove, move_id)
    if move is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Move not found")
    db.delete(move)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
