from decimal import Decimal

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import func, select

from app.api.deps import CurrentUser, DbSession
from app.core.config import settings
from app.models import Account, Transaction
from app.schemas.finance import (
    AccountCreate,
    AccountRead,
    AccountsOverview,
    AccountUpdate,
    CurrencyTotal,
)
from app.services.fx import convert, get_rate_map, quantize_money

router = APIRouter(tags=["accounts"])

ZERO = Decimal("0.00")


def _secondary() -> str:
    code = settings.secondary_currency
    return "" if code == settings.base_currency else code


def account_read(account: Account, rates: dict[str, Decimal]) -> AccountRead:
    out = AccountRead.model_validate(account)
    out.base_balance = convert(account.balance, account.currency, rates)
    secondary = _secondary()
    if secondary:
        if account.currency == secondary:
            out.secondary_balance = account.balance
        elif out.base_balance is not None and rates.get(secondary):
            out.secondary_balance = quantize_money(Decimal(out.base_balance) / rates[secondary])
    return out


def _get(db: DbSession, account_id: int) -> Account:
    account = db.get(Account, account_id)
    if account is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    return account


@router.get("/accounts", response_model=AccountsOverview)
def overview(
    db: DbSession, current_user: CurrentUser, include_archived: bool = False
) -> AccountsOverview:
    stmt = select(Account).order_by(Account.sort_order, Account.id)
    if not include_archived:
        stmt = stmt.where(Account.is_archived.is_(False))
    rates = get_rate_map(db)
    accounts = [account_read(a, rates) for a in db.scalars(stmt).all()]

    assets = liabilities = ZERO
    unconvertible: set[str] = set()
    per_currency: dict[str, list] = {}
    for account in accounts:
        if not account.include_in_total or account.is_archived:
            continue
        sign = -1 if account.is_liability else 1
        bucket = per_currency.setdefault(account.currency, [ZERO, ZERO, 0, True])
        bucket[0] += sign * Decimal(account.balance)
        bucket[2] += 1
        if account.base_balance is None:
            bucket[3] = False
            unconvertible.add(account.currency)
            continue
        bucket[1] += sign * Decimal(account.base_balance)
        if account.is_liability:
            liabilities += Decimal(account.base_balance)
        else:
            assets += Decimal(account.base_balance)

    net = assets - liabilities
    secondary = _secondary()
    secondary_rate = rates.get(secondary) if secondary else None
    return AccountsOverview(
        base_currency=settings.base_currency,
        secondary_currency=secondary or None,
        net_worth=quantize_money(net),
        net_worth_secondary=quantize_money(net / secondary_rate) if secondary_rate else None,
        assets=quantize_money(assets),
        liabilities=quantize_money(liabilities),
        by_currency=[
            CurrencyTotal(
                currency=code,
                total=quantize_money(v[0]),
                base_total=quantize_money(v[1]) if v[3] else None,
                account_count=v[2],
            )
            for code, v in sorted(per_currency.items())
        ],
        accounts=accounts,
        unconvertible=sorted(unconvertible),
    )


@router.post("/accounts", response_model=AccountRead, status_code=status.HTTP_201_CREATED)
def create_account(payload: AccountCreate, db: DbSession, current_user: CurrentUser) -> AccountRead:
    account = Account(**payload.model_dump())
    db.add(account)
    db.commit()
    db.refresh(account)
    return account_read(account, get_rate_map(db))


@router.patch("/accounts/{account_id}", response_model=AccountRead)
def update_account(
    account_id: int, payload: AccountUpdate, db: DbSession, current_user: CurrentUser
) -> AccountRead:
    account = _get(db, account_id)
    data = payload.model_dump(exclude_unset=True)
    if "currency" in data and data["currency"] != account.currency:
        used = db.scalar(
            select(func.count())
            .select_from(Transaction)
            .where((Transaction.account_id == account.id) | (Transaction.to_account_id == account.id))
        )
        if used:
            raise HTTPException(
                status_code=409,
                detail="This account already has transactions; its currency can't change",
            )
    for field, value in data.items():
        setattr(account, field, value)
    db.commit()
    db.refresh(account)
    return account_read(account, get_rate_map(db))


@router.delete("/accounts/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(account_id: int, db: DbSession, current_user: CurrentUser) -> Response:
    """Its transactions stay in your history, just without an account."""
    db.delete(_get(db, account_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
