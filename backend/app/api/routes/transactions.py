from datetime import date

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import or_, select

from app.api.deps import CurrentUser, DbSession
from app.models import Transaction
from app.schemas.finance import TransactionCreate, TransactionRead, TransactionUpdate
from app.services import ledger
from app.services.reports import month_bounds

router = APIRouter(tags=["transactions"])


def _get(db: DbSession, txn_id: int) -> Transaction:
    txn = db.get(Transaction, txn_id)
    if txn is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transaction not found")
    return txn


@router.get("/transactions", response_model=list[TransactionRead])
def list_transactions(
    db: DbSession,
    current_user: CurrentUser,
    year: int | None = Query(default=None, ge=1970, le=2999),
    month: int | None = Query(default=None, ge=1, le=12),
    date_from: date | None = None,
    date_to: date | None = None,
    kind: str | None = None,
    category_id: int | None = None,
    uncategorized: bool = False,
    account_id: int | None = None,
    q: str | None = None,
    limit: int = Query(default=500, ge=1, le=5000),
) -> list[Transaction]:
    stmt = select(Transaction).order_by(Transaction.occurred_on.desc(), Transaction.id.desc())
    if year and month:
        start, end = month_bounds(year, month)
        stmt = stmt.where(Transaction.occurred_on >= start, Transaction.occurred_on <= end)
    elif year:
        stmt = stmt.where(
            Transaction.occurred_on >= date(year, 1, 1), Transaction.occurred_on <= date(year, 12, 31)
        )
    if date_from:
        stmt = stmt.where(Transaction.occurred_on >= date_from)
    if date_to:
        stmt = stmt.where(Transaction.occurred_on <= date_to)
    if kind:
        stmt = stmt.where(Transaction.kind == kind)
    if uncategorized:
        stmt = stmt.where(Transaction.category_id.is_(None), Transaction.kind != "transfer")
    elif category_id is not None:
        stmt = stmt.where(Transaction.category_id == category_id)
    if account_id is not None:
        stmt = stmt.where(
            or_(Transaction.account_id == account_id, Transaction.to_account_id == account_id)
        )
    if q and q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Transaction.merchant.ilike(like), Transaction.note.ilike(like)))
    return list(db.scalars(stmt.limit(limit)).all())


@router.post("/transactions", response_model=TransactionRead, status_code=status.HTTP_201_CREATED)
def create_transaction(
    payload: TransactionCreate, db: DbSession, current_user: CurrentUser
) -> Transaction:
    try:
        txn = ledger.create(db, **payload.model_dump(), source="manual")
        if payload.category_id is not None:
            ledger.categorizer.learn(db, payload.merchant, payload.category_id)
    except ledger.LedgerError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    db.commit()
    db.refresh(txn)
    return txn


@router.get("/transactions/{txn_id}", response_model=TransactionRead)
def get_transaction(txn_id: int, db: DbSession, current_user: CurrentUser) -> Transaction:
    return _get(db, txn_id)


@router.patch("/transactions/{txn_id}", response_model=TransactionRead)
def update_transaction(
    txn_id: int, payload: TransactionUpdate, db: DbSession, current_user: CurrentUser
) -> Transaction:
    txn = _get(db, txn_id)
    try:
        ledger.update(db, txn, payload.model_dump(exclude_unset=True))
    except ledger.LedgerError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    db.commit()
    db.refresh(txn)
    return txn


@router.delete("/transactions/{txn_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transaction(txn_id: int, db: DbSession, current_user: CurrentUser) -> Response:
    """Also puts the account balances back the way they were."""
    ledger.delete(db, _get(db, txn_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
