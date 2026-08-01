from datetime import date

from fastapi import APIRouter, HTTPException, Query, Response, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app.api.deps import CurrentUser, DbSession
from app.models import Income, IncomeSource
from app.schemas.income import (
    IncomeCreate,
    IncomeRead,
    IncomeSourceCreate,
    IncomeSourceRead,
    IncomeSourceUpdate,
    IncomeUpdate,
)
from app.services.enrich import income_read, income_source_read
from app.services.fx import get_rate_map

router = APIRouter(tags=["income"])


def _get_source(db: DbSession, source_id: int) -> IncomeSource:
    source = db.scalar(
        select(IncomeSource)
        .where(IncomeSource.id == source_id)
        .options(selectinload(IncomeSource.incomes))
    )
    if source is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Income source not found")
    return source


def _get_income(db: DbSession, income_id: int) -> Income:
    income = db.get(Income, income_id)
    if income is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Income not found")
    return income


def _apply_status_side_effects(income: Income) -> None:
    if income.status == "received" and income.received_date is None:
        income.received_date = date.today()
    elif income.status != "received":
        income.received_date = None


# --------------------------------------------------------------- sources

@router.get("/income-sources", response_model=list[IncomeSourceRead])
def list_income_sources(
    db: DbSession, current_user: CurrentUser, include_archived: bool = False
) -> list[IncomeSourceRead]:
    stmt = (
        select(IncomeSource)
        .options(selectinload(IncomeSource.incomes))
        .order_by(IncomeSource.sort_order, IncomeSource.name)
    )
    if not include_archived:
        stmt = stmt.where(IncomeSource.is_archived.is_(False))
    rates = get_rate_map(db)
    today = date.today()
    return [income_source_read(s, rates, today) for s in db.scalars(stmt).all()]


@router.post(
    "/income-sources", response_model=IncomeSourceRead, status_code=status.HTTP_201_CREATED
)
def create_income_source(
    payload: IncomeSourceCreate, db: DbSession, current_user: CurrentUser
) -> IncomeSourceRead:
    source = IncomeSource(**payload.model_dump())
    db.add(source)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A source named {payload.name!r} already exists",
        ) from exc
    db.refresh(source)
    return income_source_read(source, get_rate_map(db))


@router.get("/income-sources/{source_id}", response_model=IncomeSourceRead)
def get_income_source(
    source_id: int, db: DbSession, current_user: CurrentUser
) -> IncomeSourceRead:
    return income_source_read(_get_source(db, source_id), get_rate_map(db))


@router.patch("/income-sources/{source_id}", response_model=IncomeSourceRead)
def update_income_source(
    source_id: int, payload: IncomeSourceUpdate, db: DbSession, current_user: CurrentUser
) -> IncomeSourceRead:
    source = _get_source(db, source_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(source, field, value)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="A source with that name already exists"
        ) from exc
    db.refresh(source)
    return income_source_read(source, get_rate_map(db))


@router.delete("/income-sources/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_income_source(source_id: int, db: DbSession, current_user: CurrentUser) -> Response:
    db.delete(_get_source(db, source_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --------------------------------------------------------------- incomes

@router.get("/incomes", response_model=list[IncomeRead])
def list_incomes(
    db: DbSession,
    current_user: CurrentUser,
    source_id: int | None = None,
    ungrouped: bool = False,
    status_filter: list[str] | None = Query(default=None, alias="status"),
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[IncomeRead]:
    stmt = select(Income).order_by(Income.expected_date.nulls_last(), Income.id.desc())
    if ungrouped:
        stmt = stmt.where(Income.source_id.is_(None))
    elif source_id is not None:
        stmt = stmt.where(Income.source_id == source_id)
    if status_filter:
        stmt = stmt.where(Income.status.in_(status_filter))
    if date_from is not None:
        stmt = stmt.where(Income.expected_date >= date_from)
    if date_to is not None:
        stmt = stmt.where(Income.expected_date <= date_to)

    rates = get_rate_map(db)
    today = date.today()
    return [income_read(i, rates, today) for i in db.scalars(stmt).all()]


@router.post("/incomes", response_model=IncomeRead, status_code=status.HTTP_201_CREATED)
def create_income(payload: IncomeCreate, db: DbSession, current_user: CurrentUser) -> IncomeRead:
    if payload.source_id is not None:
        _get_source(db, payload.source_id)
    income = Income(**payload.model_dump())
    _apply_status_side_effects(income)
    db.add(income)
    db.commit()
    db.refresh(income)
    return income_read(income, get_rate_map(db))


@router.get("/incomes/{income_id}", response_model=IncomeRead)
def get_income(income_id: int, db: DbSession, current_user: CurrentUser) -> IncomeRead:
    return income_read(_get_income(db, income_id), get_rate_map(db))


@router.patch("/incomes/{income_id}", response_model=IncomeRead)
def update_income(
    income_id: int, payload: IncomeUpdate, db: DbSession, current_user: CurrentUser
) -> IncomeRead:
    income = _get_income(db, income_id)
    data = payload.model_dump(exclude_unset=True)
    if data.get("source_id") is not None:
        _get_source(db, data["source_id"])
    for field, value in data.items():
        setattr(income, field, value)
    if "status" in data and "received_date" not in data:
        _apply_status_side_effects(income)
    db.commit()
    db.refresh(income)
    return income_read(income, get_rate_map(db))


class IncomeStatusBulk(BaseModel):
    ids: list[int]
    status: str = "received"
    received_date: date | None = None


@router.post("/incomes/bulk-status", response_model=list[IncomeRead])
def bulk_set_status(
    payload: IncomeStatusBulk, db: DbSession, current_user: CurrentUser
) -> list[IncomeRead]:
    if payload.status not in {"expected", "received", "cancelled"}:
        raise HTTPException(status_code=422, detail="status must be expected, received or cancelled")
    if not payload.ids:
        return []

    rows = db.scalars(select(Income).where(Income.id.in_(payload.ids))).all()
    for income in rows:
        income.status = payload.status
        if payload.status == "received":
            income.received_date = payload.received_date or income.received_date or date.today()
        else:
            income.received_date = None
    db.commit()

    rates = get_rate_map(db)
    today = date.today()
    return [income_read(db.get(Income, i.id), rates, today) for i in rows]


@router.delete("/incomes/{income_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_income(income_id: int, db: DbSession, current_user: CurrentUser) -> Response:
    db.delete(_get_income(db, income_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
