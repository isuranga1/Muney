from datetime import date

from pydantic import BaseModel

from app.schemas.common import Money


class CurrencyBreakdown(BaseModel):
    currency: str
    original_total: Money
    converted_total: Money
    account_count: int
    rate_available: bool


class BankBreakdown(BaseModel):
    bank_id: int
    bank_name: str
    color: str | None
    converted_total: Money
    account_count: int


class GroupBreakdown(BaseModel):
    group_id: int | None
    group_name: str
    color: str | None
    converted_total: Money
    paid_converted: Money
    outstanding_converted: Money


class PeriodSummary(BaseModel):
    period_start: date
    period_end: date
    income_received: Money
    income_expected: Money
    expenses_paid: Money
    expenses_outstanding: Money
    net_actual: Money
    net_projected: Money


class DashboardSummary(BaseModel):
    base_currency: str
    fx_is_stale: bool

    assets_total: Money
    liabilities_total: Money
    net_worth: Money
    account_count: int
    bank_count: int

    by_currency: list[CurrencyBreakdown]
    by_bank: list[BankBreakdown]
    expenses_by_group: list[GroupBreakdown]

    this_month: PeriodSummary
    overdue_total: Money
    overdue_count: int
    unconvertible_currencies: list[str]
