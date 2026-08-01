from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app.api.deps import CurrentUser, DbSession
from app.models import Account, Bank
from app.schemas.bank import (
    AccountCreate,
    AccountRead,
    AccountUpdate,
    BankCreate,
    BankRead,
    BankUpdate,
)
from app.services.enrich import account_read, bank_read
from app.services.fx import get_rate_map

router = APIRouter(tags=["banks"])


def _get_bank(db: DbSession, bank_id: int) -> Bank:
    bank = db.scalar(
        select(Bank).where(Bank.id == bank_id).options(selectinload(Bank.accounts))
    )
    if bank is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bank not found")
    return bank


def _get_account(db: DbSession, account_id: int) -> Account:
    account = db.get(Account, account_id)
    if account is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    return account


# --------------------------------------------------------------------- banks

@router.get("/banks", response_model=list[BankRead])
def list_banks(
    db: DbSession, current_user: CurrentUser, include_archived: bool = False
) -> list[BankRead]:
    stmt = select(Bank).options(selectinload(Bank.accounts)).order_by(Bank.sort_order, Bank.name)
    if not include_archived:
        stmt = stmt.where(Bank.is_archived.is_(False))
    rates = get_rate_map(db)
    return [bank_read(b, rates) for b in db.scalars(stmt).all()]


@router.post("/banks", response_model=BankRead, status_code=status.HTTP_201_CREATED)
def create_bank(payload: BankCreate, db: DbSession, current_user: CurrentUser) -> BankRead:
    bank = Bank(**payload.model_dump())
    db.add(bank)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A bank named {payload.name!r} already exists",
        ) from exc
    db.refresh(bank)
    return bank_read(bank, get_rate_map(db))


@router.get("/banks/{bank_id}", response_model=BankRead)
def get_bank(bank_id: int, db: DbSession, current_user: CurrentUser) -> BankRead:
    return bank_read(_get_bank(db, bank_id), get_rate_map(db))


@router.patch("/banks/{bank_id}", response_model=BankRead)
def update_bank(
    bank_id: int, payload: BankUpdate, db: DbSession, current_user: CurrentUser
) -> BankRead:
    bank = _get_bank(db, bank_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(bank, field, value)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="A bank with that name already exists"
        ) from exc
    db.refresh(bank)
    return bank_read(bank, get_rate_map(db))


@router.delete("/banks/{bank_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_bank(bank_id: int, db: DbSession, current_user: CurrentUser) -> Response:
    """Removes the bank and every account under it."""
    bank = _get_bank(db, bank_id)
    db.delete(bank)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ------------------------------------------------------------------ accounts

@router.get("/accounts", response_model=list[AccountRead])
def list_accounts(
    db: DbSession,
    current_user: CurrentUser,
    bank_id: int | None = None,
    include_inactive: bool = True,
) -> list[AccountRead]:
    stmt = select(Account).order_by(Account.sort_order, Account.id)
    if bank_id is not None:
        stmt = stmt.where(Account.bank_id == bank_id)
    if not include_inactive:
        stmt = stmt.where(Account.is_active.is_(True))
    rates = get_rate_map(db)
    return [account_read(a, rates) for a in db.scalars(stmt).all()]


@router.post("/accounts", response_model=AccountRead, status_code=status.HTTP_201_CREATED)
def create_account(
    payload: AccountCreate, db: DbSession, current_user: CurrentUser
) -> AccountRead:
    _get_bank(db, payload.bank_id)
    account = Account(**payload.model_dump())
    db.add(account)
    db.commit()
    db.refresh(account)
    return account_read(account, get_rate_map(db))


@router.get("/accounts/{account_id}", response_model=AccountRead)
def get_account(account_id: int, db: DbSession, current_user: CurrentUser) -> AccountRead:
    return account_read(_get_account(db, account_id), get_rate_map(db))


@router.patch("/accounts/{account_id}", response_model=AccountRead)
def update_account(
    account_id: int, payload: AccountUpdate, db: DbSession, current_user: CurrentUser
) -> AccountRead:
    account = _get_account(db, account_id)
    data = payload.model_dump(exclude_unset=True)
    if "bank_id" in data and data["bank_id"] is not None:
        _get_bank(db, data["bank_id"])
    for field, value in data.items():
        setattr(account, field, value)
    db.commit()
    db.refresh(account)
    return account_read(account, get_rate_map(db))


@router.delete("/accounts/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(account_id: int, db: DbSession, current_user: CurrentUser) -> Response:
    db.delete(_get_account(db, account_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
