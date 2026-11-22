from datetime import date

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.deps import CurrentUser, DbSession
from app.models import BudgetBucket, BudgetMonth
from app.schemas.finance import (
    BucketCreate,
    BucketRead,
    BucketUpdate,
    BudgetBasisSet,
    BudgetMonthStatus,
)
from app.services import reports

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
