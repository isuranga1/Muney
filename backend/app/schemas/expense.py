from datetime import date

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import CurrencyCode, ExpenseStatus, Money, ORMModel, Recurrence


class ExpenseCreate(BaseModel):
    group_id: int | None = None
    name: str = Field(min_length=1, max_length=160)
    amount: Money
    currency: CurrencyCode
    status: ExpenseStatus = ExpenseStatus.pending
    due_date: date | None = None
    paid_date: date | None = None
    recurrence: Recurrence = Recurrence.none
    account_id: int | None = None
    vendor: str | None = Field(default=None, max_length=120)
    notes: str | None = None


class ExpenseUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    group_id: int | None = None
    name: str | None = Field(default=None, min_length=1, max_length=160)
    amount: Money | None = None
    currency: CurrencyCode | None = None
    status: ExpenseStatus | None = None
    due_date: date | None = None
    paid_date: date | None = None
    recurrence: Recurrence | None = None
    account_id: int | None = None
    vendor: str | None = Field(default=None, max_length=120)
    notes: str | None = None


class ExpenseRead(ORMModel):
    id: int
    group_id: int | None
    name: str
    amount: Money
    currency: str
    status: str
    due_date: date | None
    paid_date: date | None
    recurrence: str
    account_id: int | None
    vendor: str | None
    notes: str | None

    converted_amount: Money | None = None
    converted_currency: str | None = None
    rate_available: bool = True
    # Derived, never stored: pending and past its due date.
    is_overdue: bool = False


class ExpenseGroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = None
    color: str | None = Field(default=None, max_length=9)
    sort_order: int = 0
    is_archived: bool = False


class ExpenseGroupUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    color: str | None = Field(default=None, max_length=9)
    sort_order: int | None = None
    is_archived: bool | None = None


class ExpenseGroupRead(ORMModel):
    id: int
    name: str
    description: str | None
    color: str | None
    sort_order: int
    is_archived: bool
    expenses: list[ExpenseRead] = []

    converted_currency: str | None = None
    total_converted: Money = 0
    paid_converted: Money = 0
    outstanding_converted: Money = 0
    expense_count: int = 0
    paid_count: int = 0
