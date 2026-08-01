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
from typing import NamedTuple
from urllib.parse import urlsplit

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import FxRate

CENTS = Decimal("0.01")


class FxError(RuntimeError):
    """Upstream rate provider was unreachable or returned something unusable."""


class UpstreamRates(NamedTuple):
    rates: dict[str, Decimal]
    # When we pulled it, not when the provider published it — see the note in
    # fetch_upstream_rates.
    fetched_at: datetime
    # Which URL actually answered — the fallback may have served this.
    source_url: str


def provider_label(url: str) -> str:
    """Short name for a provider, for the `source` column and the UI.

    Storing the raw URL there is wrong twice over: it overflows the column
    (a CDN path runs to ~90 characters) and the host is the only part a reader
    actually cares about.
    """
    try:
        host = urlsplit(url).hostname
    except ValueError:
        host = None
    return (host or url)[:60]


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


def _extract_rate_table(payload: dict) -> dict | None:
    """Find the currency table in a provider response.

    Two shapes are supported, so the provider URL stays swappable:

    fawazahmed0/currency-api (the default) nests the table under the lowercase
    base code and has no wrapper key:
        {"date": "2026-07-31", "usd": {"lkr": 335.81, "sgd": 1.28, ...}}

    open.er-api.com / frankfurter-style put it under "rates":
        {"rates": {"LKR": 335.81, ...}, "time_last_update_unix": 1753...}
    """
    for key in ("rates", "conversion_rates"):
        table = payload.get(key)
        if isinstance(table, dict):
            return table

    pivot_key = settings.fx_pivot_currency.lower()
    table = payload.get(pivot_key)
    if isinstance(table, dict):
        return table

    # Fall back to the only nested object, if the payload has exactly one.
    nested = [value for value in payload.values() if isinstance(value, dict)]
    return nested[0] if len(nested) == 1 else None


def fetch_upstream_rates() -> UpstreamRates:
    """Pull pivot-based rates from the configured provider.

    Tries the primary URL, then the fallback if one is configured — the default
    primary is a jsdelivr CDN path, which is fast but does occasionally 5xx.
    """
    urls = [settings.fx_api_url]
    if settings.fx_fallback_api_url and settings.fx_fallback_api_url not in urls:
        urls.append(settings.fx_fallback_api_url)

    payload: dict | None = None
    used_url = urls[0]
    errors: list[str] = []
    for url in urls:
        try:
            response = httpx.get(url, timeout=20.0, follow_redirects=True)
            response.raise_for_status()
            candidate = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            errors.append(f"{url}: {exc}")
            continue

        if not isinstance(candidate, dict):
            errors.append(f"{url}: response was not a JSON object")
            continue
        if candidate.get("result") == "error":
            errors.append(f"{url}: {candidate.get('error-type', 'provider error')}")
            continue

        payload = candidate
        used_url = url
        break

    if payload is None:
        raise FxError("could not reach any FX provider — " + "; ".join(errors))

    raw = _extract_rate_table(payload)
    if raw is None:
        raise FxError("FX provider response did not contain a recognisable rates table")

    rates: dict[str, Decimal] = {}
    for code, value in raw.items():
        try:
            rates[str(code).upper()] = Decimal(str(value))
        except (InvalidOperation, TypeError, ValueError):
            continue  # crypto/metals entries can be null or non-numeric

    if not rates:
        raise FxError("FX provider returned a rates table with no usable numbers")

    rates.setdefault(settings.fx_pivot_currency, Decimal("1"))

    # `fetched_at` is when *we* pulled the data, deliberately not the provider's
    # own publication timestamp. This provider publishes once a day at 00:00 UTC;
    # storing that would make rates read as "stale" for most of every day and
    # trigger a pointless re-fetch on every startup, moments after succeeding.
    return UpstreamRates(rates, _now(), used_url)


def refresh_rates(db: Session) -> list[FxRate]:
    """Refresh every supported currency -> base pair. Manual rows are left alone."""
    pivot_rates, fetched_at, source_url = fetch_upstream_rates()
    source = provider_label(source_url)

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
        row.source = source
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
