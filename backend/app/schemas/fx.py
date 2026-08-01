from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import CurrencyCode, ORMModel, Rate


class FxRateRead(ORMModel):
    id: int
    base_currency: str
    quote_currency: str
    rate: Rate
    source: str
    is_manual: bool
    fetched_at: datetime


class FxRateSet(BaseModel):
    currency: CurrencyCode
    rate: Rate = Field(gt=0)


class FxSnapshot(BaseModel):
    base_currency: str
    rates: list[FxRateRead]
    is_stale: bool
    last_updated: datetime | None = None
    missing_currencies: list[str] = []
