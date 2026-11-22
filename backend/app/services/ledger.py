"""Transactions and the account balances they move — kept in step, always.

Every transaction records the exact delta it added to each account
(`account_delta`, `to_account_delta`). Editing reverses those and re-applies;
deleting reverses them. So a balance is never silently wrong after a fix-up.

Sign rules (liabilities hold debt as a positive number):
    money out of an asset     -> balance down
    money out on a credit card -> balance (debt) up
    money in, either way round -> the opposite
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import Account, Category, Transaction
from app.services import categorizer
from app.services.fx import convert, get_rate_map, quantize_money

RateMap = dict[str, Decimal]


class LedgerError(ValueError):
    """The transaction can't be recorded as given."""


def between(amount: Decimal, source: str, target: str, rates: RateMap) -> Decimal | None:
    """Convert between any two currencies via the base currency."""
    if source == target:
        return Decimal(amount)
    in_base = convert(amount, source, rates)
    target_rate = rates.get(target)
    if in_base is None or not target_rate:
        return None
    return quantize_money(Decimal(in_base) / target_rate)


def _sign(outflow: bool, account: Account) -> int:
    return 1 if outflow == account.is_liability else -1


def _account(db: Session, account_id: int | None, label: str = "account") -> Account | None:
    if account_id is None:
        return None
    account = db.get(Account, account_id)
    if account is None:
        raise LedgerError(f"Unknown {label} id {account_id}")
    return account


def _apply(db: Session, txn: Transaction, rates: RateMap, to_amount: Decimal | None) -> None:
    txn.base_amount = convert(txn.amount, txn.currency, rates)

    source = _account(db, txn.account_id)
    if source is not None:
        amount = between(txn.amount, txn.currency, source.currency, rates)
        if amount is None:
            raise LedgerError(
                f"No {txn.currency}->{source.currency} rate to move {source.name}'s balance"
            )
        delta = _sign(txn.kind != "income", source) * amount
        source.balance = quantize_money(Decimal(source.balance) + delta)
        txn.account_delta = delta
    else:
        txn.account_delta = None

    target = _account(db, txn.to_account_id, "destination account")
    if target is not None:
        amount = to_amount or between(txn.amount, txn.currency, target.currency, rates)
        if amount is None:
            raise LedgerError(
                f"No {txn.currency}->{target.currency} rate — enter the amount received"
            )
        delta = _sign(False, target) * Decimal(amount)
        target.balance = quantize_money(Decimal(target.balance) + delta)
        txn.to_account_delta = delta
    else:
        txn.to_account_delta = None


def _revert(db: Session, txn: Transaction) -> None:
    for account_id, delta in (
        (txn.account_id, txn.account_delta),
        (txn.to_account_id, txn.to_account_delta),
    ):
        if account_id is None or delta is None:
            continue
        account = db.get(Account, account_id)
        if account is not None:
            account.balance = quantize_money(Decimal(account.balance) - Decimal(delta))
    txn.account_delta = None
    txn.to_account_delta = None


def _validate(db: Session, txn: Transaction) -> None:
    if txn.kind == "transfer":
        if txn.account_id is None or txn.to_account_id is None:
            raise LedgerError("A transfer needs both a from and a to account")
        if txn.account_id == txn.to_account_id:
            raise LedgerError("A transfer needs two different accounts")
        txn.category_id = None
    else:
        txn.to_account_id = None
        if txn.category_id is not None:
            category = db.get(Category, txn.category_id)
            if category is None:
                raise LedgerError(f"Unknown category id {txn.category_id}")
            if category.kind != txn.kind:
                raise LedgerError(f"{category.name} is an {category.kind} category")


def create(
    db: Session,
    *,
    kind: str,
    amount: Decimal,
    currency: str | None = None,
    occurred_on: date | None = None,
    occurred_at: datetime | None = None,
    account_id: int | None = None,
    to_account_id: int | None = None,
    to_amount: Decimal | None = None,
    category_id: int | None = None,
    merchant: str | None = None,
    note: str | None = None,
    source: str = "manual",
    categorized_by: str | None = None,
    auto_categorize: bool = True,
    categorize_text: str | None = None,
) -> Transaction:
    account = _account(db, account_id)
    txn = Transaction(
        kind=kind,
        amount=quantize_money(Decimal(amount)),
        currency=(currency or (account.currency if account else settings.base_currency)).upper(),
        occurred_on=occurred_on or date.today(),
        occurred_at=occurred_at,
        account_id=account_id,
        to_account_id=to_account_id,
        category_id=category_id,
        merchant=merchant,
        note=note,
        source=source,
        categorized_by=categorized_by if category_id is not None else None,
    )
    if category_id is not None and categorized_by is None:
        txn.categorized_by = "user"
    elif category_id is None and auto_categorize and kind != "transfer":
        category, method = categorizer.categorize(db, kind, merchant, categorize_text or note)
        if category is not None:
            txn.category_id, txn.categorized_by = category.id, method

    _validate(db, txn)
    _apply(db, txn, get_rate_map(db), to_amount)
    db.add(txn)
    db.flush()
    return txn


def update(db: Session, txn: Transaction, data: dict) -> Transaction:
    to_amount = data.pop("to_amount", None)
    # Keep a hand-entered cross-currency transfer amount across unrelated edits.
    if (
        to_amount is None
        and txn.to_account_delta is not None
        and not {"amount", "currency", "to_account_id"} & data.keys()
    ):
        to_amount = abs(Decimal(txn.to_account_delta))

    if "category_id" in data and data["category_id"] != txn.category_id:
        txn.categorized_by = "user" if data["category_id"] is not None else None
        categorizer.learn(db, data.get("merchant", txn.merchant), data["category_id"])

    _revert(db, txn)
    for field, value in data.items():
        setattr(txn, field, value)
    if "account_id" in data and "currency" not in data and txn.account_id is not None:
        account = _account(db, txn.account_id)
        if account is not None:
            txn.currency = account.currency
    _validate(db, txn)
    _apply(db, txn, get_rate_map(db), to_amount)
    db.flush()
    return txn


def delete(db: Session, txn: Transaction) -> None:
    _revert(db, txn)
    db.delete(txn)
    db.flush()
