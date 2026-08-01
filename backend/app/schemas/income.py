from datetime import date

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import CurrencyCode, IncomeStatus, Money, ORMModel, Recurrence


class IncomeCreate(BaseModel):
    source_id: int | None = None
    name: str = Field(min_length=1, max_length=160)
    amount: Money
    currency: CurrencyCode
    status: IncomeStatus = IncomeStatus.expected
    expected_date: date | None = None
    received_date: date | None = None
    recurrence: Recurrence = Recurrence.none
    account_id: int | None = None
    payer: str | None = Field(default=None, max_length=120)
    notes: str | None = None


class IncomeUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_id: int | None = None
    name: str | None = Field(default=None, min_length=1, max_length=160)
    amount: Money | None = None
    currency: CurrencyCode | None = None
    status: IncomeStatus | None = None
    expected_date: date | None = None
    received_date: date | None = None
    recurrence: Recurrence | None = None
    account_id: int | None = None
    payer: str | None = Field(default=None, max_length=120)
    notes: str | None = None


class IncomeRead(ORMModel):
    id: int
    source_id: int | None
    name: str
    amount: Money
    currency: str
    status: str
    expected_date: date | None
    received_date: date | None
    recurrence: str
    account_id: int | None
    payer: str | None
    notes: str | None

    converted_amount: Money | None = None
    converted_currency: str | None = None
    rate_available: bool = True
    is_late: bool = False


class IncomeSourceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = None
    color: str | None = Field(default=None, max_length=9)
    sort_order: int = 0
    is_archived: bool = False


class IncomeSourceUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    color: str | None = Field(default=None, max_length=9)
    sort_order: int | None = None
    is_archived: bool | None = None


class IncomeSourceRead(ORMModel):
    id: int
    name: str
    description: str | None
    color: str | None
    sort_order: int
    is_archived: bool
    incomes: list[IncomeRead] = []

    converted_currency: str | None = None
    total_converted: Money = 0
    received_converted: Money = 0
    expected_converted: Money = 0
    income_count: int = 0
    received_count: int = 0
