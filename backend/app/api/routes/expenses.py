from datetime import date

from fastapi import APIRouter, HTTPException, Query, Response, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app.api.deps import CurrentUser, DbSession
from app.models import Expense, ExpenseGroup
from app.schemas.expense import (
    ExpenseCreate,
    ExpenseGroupCreate,
    ExpenseGroupRead,
    ExpenseGroupUpdate,
    ExpenseRead,
    ExpenseUpdate,
)
from app.services.enrich import expense_group_read, expense_read
from app.services.fx import get_rate_map

router = APIRouter(tags=["expenses"])


def _get_group(db: DbSession, group_id: int) -> ExpenseGroup:
    group = db.scalar(
        select(ExpenseGroup)
        .where(ExpenseGroup.id == group_id)
        .options(selectinload(ExpenseGroup.expenses))
    )
    if group is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Expense group not found")
    return group


def _get_expense(db: DbSession, expense_id: int) -> Expense:
    expense = db.get(Expense, expense_id)
    if expense is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Expense not found")
    return expense


def _apply_status_side_effects(expense: Expense) -> None:
    """Keep paid_date consistent with status without making the user set both."""
    if expense.status == "paid" and expense.paid_date is None:
        expense.paid_date = date.today()
    elif expense.status != "paid":
        expense.paid_date = None


# ---------------------------------------------------------------- groups

@router.get("/expense-groups", response_model=list[ExpenseGroupRead])
def list_expense_groups(
    db: DbSession, current_user: CurrentUser, include_archived: bool = False
) -> list[ExpenseGroupRead]:
    stmt = (
        select(ExpenseGroup)
        .options(selectinload(ExpenseGroup.expenses))
        .order_by(ExpenseGroup.sort_order, ExpenseGroup.name)
    )
    if not include_archived:
        stmt = stmt.where(ExpenseGroup.is_archived.is_(False))
    rates = get_rate_map(db)
    today = date.today()
    return [expense_group_read(g, rates, today) for g in db.scalars(stmt).all()]


@router.post(
    "/expense-groups", response_model=ExpenseGroupRead, status_code=status.HTTP_201_CREATED
)
def create_expense_group(
    payload: ExpenseGroupCreate, db: DbSession, current_user: CurrentUser
) -> ExpenseGroupRead:
    group = ExpenseGroup(**payload.model_dump())
    db.add(group)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A group named {payload.name!r} already exists",
        ) from exc
    db.refresh(group)
    return expense_group_read(group, get_rate_map(db))


@router.get("/expense-groups/{group_id}", response_model=ExpenseGroupRead)
def get_expense_group(
    group_id: int, db: DbSession, current_user: CurrentUser
) -> ExpenseGroupRead:
    return expense_group_read(_get_group(db, group_id), get_rate_map(db))


@router.patch("/expense-groups/{group_id}", response_model=ExpenseGroupRead)
def update_expense_group(
    group_id: int, payload: ExpenseGroupUpdate, db: DbSession, current_user: CurrentUser
) -> ExpenseGroupRead:
    group = _get_group(db, group_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(group, field, value)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="A group with that name already exists"
        ) from exc
    db.refresh(group)
    return expense_group_read(group, get_rate_map(db))


@router.delete("/expense-groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_expense_group(group_id: int, db: DbSession, current_user: CurrentUser) -> Response:
    """Removes the group and every expense inside it."""
    db.delete(_get_group(db, group_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# -------------------------------------------------------------- expenses

@router.get("/expenses", response_model=list[ExpenseRead])
def list_expenses(
    db: DbSession,
    current_user: CurrentUser,
    group_id: int | None = None,
    ungrouped: bool = False,
    status_filter: list[str] | None = Query(default=None, alias="status"),
    due_from: date | None = None,
    due_to: date | None = None,
) -> list[ExpenseRead]:
    stmt = select(Expense).order_by(
        Expense.due_date.nulls_last(), Expense.id.desc()
    )
    if ungrouped:
        stmt = stmt.where(Expense.group_id.is_(None))
    elif group_id is not None:
        stmt = stmt.where(Expense.group_id == group_id)
    if status_filter:
        stmt = stmt.where(Expense.status.in_(status_filter))
    if due_from is not None:
        stmt = stmt.where(Expense.due_date >= due_from)
    if due_to is not None:
        stmt = stmt.where(Expense.due_date <= due_to)

    rates = get_rate_map(db)
    today = date.today()
    return [expense_read(e, rates, today) for e in db.scalars(stmt).all()]


@router.post("/expenses", response_model=ExpenseRead, status_code=status.HTTP_201_CREATED)
def create_expense(
    payload: ExpenseCreate, db: DbSession, current_user: CurrentUser
) -> ExpenseRead:
    if payload.group_id is not None:
        _get_group(db, payload.group_id)
    expense = Expense(**payload.model_dump())
    _apply_status_side_effects(expense)
    db.add(expense)
    db.commit()
    db.refresh(expense)
    return expense_read(expense, get_rate_map(db))


@router.get("/expenses/{expense_id}", response_model=ExpenseRead)
def get_expense(expense_id: int, db: DbSession, current_user: CurrentUser) -> ExpenseRead:
    return expense_read(_get_expense(db, expense_id), get_rate_map(db))


@router.patch("/expenses/{expense_id}", response_model=ExpenseRead)
def update_expense(
    expense_id: int, payload: ExpenseUpdate, db: DbSession, current_user: CurrentUser
) -> ExpenseRead:
    expense = _get_expense(db, expense_id)
    data = payload.model_dump(exclude_unset=True)
    if data.get("group_id") is not None:
        _get_group(db, data["group_id"])
    for field, value in data.items():
        setattr(expense, field, value)
    if "status" in data and "paid_date" not in data:
        _apply_status_side_effects(expense)
    db.commit()
    db.refresh(expense)
    return expense_read(expense, get_rate_map(db))


class ExpenseStatusBulk(BaseModel):
    """Tick off (or un-tick) several rows at once — the 'slash out what's paid' action."""

    ids: list[int]
    status: str = "paid"
    paid_date: date | None = None


@router.post("/expenses/bulk-status", response_model=list[ExpenseRead])
def bulk_set_status(
    payload: ExpenseStatusBulk, db: DbSession, current_user: CurrentUser
) -> list[ExpenseRead]:
    if payload.status not in {"pending", "paid", "cancelled"}:
        raise HTTPException(status_code=422, detail="status must be pending, paid or cancelled")
    if not payload.ids:
        return []

    rows = db.scalars(select(Expense).where(Expense.id.in_(payload.ids))).all()
    for expense in rows:
        expense.status = payload.status
        if payload.status == "paid":
            expense.paid_date = payload.paid_date or expense.paid_date or date.today()
        else:
            expense.paid_date = None
    db.commit()

    rates = get_rate_map(db)
    today = date.today()
    return [expense_read(db.get(Expense, e.id), rates, today) for e in rows]


@router.delete("/expenses/{expense_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_expense(expense_id: int, db: DbSession, current_user: CurrentUser) -> Response:
    db.delete(_get_expense(db, expense_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
