"""Foreign-exchange rates: live fetch, database cache, manual override.

Every currency in the app is stored against `settings.base_currency` (LKR by
default) as a single row per pair, so converting a balance is a dict lookup and
a multiply — no network call in the request path.

Precedence when reading a rate:
    1. a manual row the user entered  (never overwritten by a refresh)
    2. the last cached row from the API
    3. nothing -> the amount is reported unconverted, and flagged
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import FxRate

CENTS = Decimal("0.01")


class FxError(RuntimeError):
    """Upstream rate provider was unreachable or returned something unusable."""


def quantize_money(value: Decimal) -> Decimal:
    try:
        return Decimal(value).quantize(CENTS, rounding=ROUND_HALF_UP)
    except InvalidOperation:
        return Decimal("0.00")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def get_rate_map(db: Session, target: str | None = None) -> dict[str, Decimal]:
    """Return {currency: rate-to-target} including the identity for `target` itself."""
    target = (target or settings.base_currency).upper()
    rows = db.scalars(select(FxRate).where(FxRate.quote_currency == target)).all()
    rate_map: dict[str, Decimal] = {row.base_currency: Decimal(row.rate) for row in rows}
    rate_map[target] = Decimal("1")
    return rate_map


def convert(
    amount: Decimal, currency: str, rate_map: dict[str, Decimal]
) -> Decimal | None:
    """Convert `amount` from `currency` into the rate map's target, or None if unknown."""
    rate = rate_map.get(currency.upper())
    if rate is None:
        return None
    return quantize_money(Decimal(amount) * rate)


def is_stale(db: Session) -> bool:
    oldest = _oldest_api_fetch(db)
    if oldest is None:
        return True
    return _now() - oldest > timedelta(hours=settings.fx_stale_after_hours)


def _oldest_api_fetch(db: Session) -> datetime | None:
    rows = db.scalars(select(FxRate).where(FxRate.is_manual.is_(False))).all()
    if not rows:
        return None
    stamps = [r.fetched_at for r in rows]
    oldest = min(stamps)
    return oldest if oldest.tzinfo else oldest.replace(tzinfo=timezone.utc)


def fetch_upstream_rates() -> tuple[dict[str, Decimal], datetime]:
    """Pull pivot-based rates from the configured provider.

    Returns ({currency: units per 1 pivot}, provider timestamp).
    """
    try:
        response = httpx.get(settings.fx_api_url, timeout=20.0)
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise FxError(f"could not reach FX provider: {exc}") from exc

    if payload.get("result") == "error":
        raise FxError(f"FX provider returned an error: {payload.get('error-type', 'unknown')}")

    raw = payload.get("rates") or payload.get("conversion_rates")
    if not isinstance(raw, dict):
        raise FxError("FX provider response did not contain a 'rates' object")

    pivot = settings.fx_pivot_currency
    rates: dict[str, Decimal] = {}
    for code, value in raw.items():
        try:
            rates[str(code).upper()] = Decimal(str(value))
        except (InvalidOperation, TypeError):
            continue
    rates.setdefault(pivot, Decimal("1"))

    timestamp = payload.get("time_last_update_unix")
    fetched_at = (
        datetime.fromtimestamp(int(timestamp), tz=timezone.utc)
        if isinstance(timestamp, (int, float))
        else _now()
    )
    return rates, fetched_at


def refresh_rates(db: Session) -> list[FxRate]:
    """Refresh every supported currency -> base pair. Manual rows are left alone."""
    pivot_rates, fetched_at = fetch_upstream_rates()

    target = settings.base_currency
    target_per_pivot = pivot_rates.get(target)
    if not target_per_pivot:
        raise FxError(f"FX provider does not quote the base currency {target}")

    existing = {
        (row.base_currency, row.quote_currency): row
        for row in db.scalars(select(FxRate).where(FxRate.quote_currency == target)).all()
    }

    updated: list[FxRate] = []
    for code in sorted(settings.currency_set):
        if code == target:
            continue
        per_pivot = pivot_rates.get(code)
        if not per_pivot:
            continue  # provider does not quote it; keep whatever we already had

        row = existing.get((code, target))
        if row is not None and row.is_manual:
            continue

        rate = (Decimal(target_per_pivot) / Decimal(per_pivot)).quantize(Decimal("0.00000001"))
        if row is None:
            row = FxRate(base_currency=code, quote_currency=target)
            db.add(row)
        row.rate = rate
        row.source = settings.fx_api_url
        row.is_manual = False
        row.fetched_at = fetched_at
        updated.append(row)

    db.commit()
    for row in updated:
        db.refresh(row)
    return updated


def set_manual_rate(db: Session, currency: str, rate: Decimal) -> FxRate:
    """Pin a rate by hand. Survives every subsequent refresh until cleared."""
    currency = currency.upper()
    target = settings.base_currency
    if currency == target:
        raise ValueError(f"{target} is the base currency; its rate is always 1")
    if rate <= 0:
        raise ValueError("rate must be greater than zero")

    row = db.scalar(
        select(FxRate).where(
            FxRate.base_currency == currency, FxRate.quote_currency == target
        )
    )
    if row is None:
        row = FxRate(base_currency=currency, quote_currency=target)
        db.add(row)
    row.rate = Decimal(rate)
    row.source = "manual"
    row.is_manual = True
    row.fetched_at = _now()
    db.commit()
    db.refresh(row)
    return row


def clear_manual_rate(db: Session, currency: str) -> None:
    """Drop a manual override so the next refresh repopulates it from the API."""
    row = db.scalar(
        select(FxRate).where(
            FxRate.base_currency == currency.upper(),
            FxRate.quote_currency == settings.base_currency,
            FxRate.is_manual.is_(True),
        )
    )
    if row is not None:
        db.delete(row)
        db.commit()


def refresh_if_stale(db: Session) -> bool:
    """Best-effort background-ish refresh. Never raises into the request path."""
    if not is_stale(db):
        return False
    try:
        refresh_rates(db)
        return True
    except FxError:
        db.rollback()
        return False
