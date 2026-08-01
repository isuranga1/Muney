from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession
from app.core.config import settings
from app.models import FxRate
from app.schemas.common import Message
from app.schemas.fx import FxRateRead, FxRateSet, FxSnapshot
from app.services import fx as fx_service

router = APIRouter(prefix="/fx", tags=["fx"])


def _snapshot(db: DbSession) -> FxSnapshot:
    rows = db.scalars(
        select(FxRate)
        .where(FxRate.quote_currency == settings.base_currency)
        .order_by(FxRate.base_currency)
    ).all()
    known = {row.base_currency for row in rows} | {settings.base_currency}
    missing = sorted(settings.currency_set - known)
    last_updated = max((r.fetched_at for r in rows), default=None)
    return FxSnapshot(
        base_currency=settings.base_currency,
        rates=[FxRateRead.model_validate(r) for r in rows],
        is_stale=fx_service.is_stale(db),
        last_updated=last_updated,
        missing_currencies=missing,
    )


@router.get("", response_model=FxSnapshot)
def get_rates(db: DbSession, current_user: CurrentUser) -> FxSnapshot:
    return _snapshot(db)


@router.post("/refresh", response_model=FxSnapshot)
def refresh(db: DbSession, current_user: CurrentUser) -> FxSnapshot:
    """Pull fresh rates from the provider. Manual overrides are preserved."""
    try:
        fx_service.refresh_rates(db)
    except fx_service.FxError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    return _snapshot(db)


@router.put("/manual", response_model=FxRateRead)
def set_manual(payload: FxRateSet, db: DbSession, current_user: CurrentUser) -> FxRateRead:
    """Pin `1 <currency> = rate <base>` by hand; refreshes will not touch it."""
    try:
        row = fx_service.set_manual_rate(db, payload.currency, payload.rate)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return FxRateRead.model_validate(row)


@router.delete("/manual/{currency}", response_model=Message)
def clear_manual(currency: str, db: DbSession, current_user: CurrentUser) -> Message:
    fx_service.clear_manual_rate(db, currency)
    return Message(detail=f"Manual override for {currency.upper()} cleared")


@router.delete("/{currency}", status_code=status.HTTP_204_NO_CONTENT)
def delete_rate(currency: str, db: DbSession, current_user: CurrentUser) -> Response:
    row = db.scalar(
        select(FxRate).where(
            FxRate.base_currency == currency.upper(),
            FxRate.quote_currency == settings.base_currency,
        )
    )
    if row is not None:
        db.delete(row)
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
