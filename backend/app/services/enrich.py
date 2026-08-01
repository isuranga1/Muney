"""Turn ORM rows into API models, attaching base-currency conversions.

Conversion lives here rather than on the models so that a single FX rate map,
loaded once per request, serves every row in the response.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from app.core.config import settings
from app.models import Account, Bank, Expense, ExpenseGroup, Income, IncomeSource
from app.schemas.bank import AccountRead, BankRead
from app.schemas.expense import ExpenseGroupRead, ExpenseRead
from app.schemas.income import IncomeRead, IncomeSourceRead
from app.services.fx import convert, quantize_money

ZERO = Decimal("0.00")
RateMap = dict[str, Decimal]


def account_read(account: Account, rates: RateMap) -> AccountRead:
    out = AccountRead.model_validate(account)
    converted = convert(account.balance, account.currency, rates)
    out.converted_balance = converted
    out.converted_currency = settings.base_currency
    out.rate_available = converted is not None
    return out


def _signed(account: AccountRead) -> Decimal:
    """Liabilities pull net worth down; everything else adds to it."""
    if account.converted_balance is None:
        return ZERO
    value = Decimal(account.converted_balance)
    return -value if account.is_liability else value


def bank_read(bank: Bank, rates: RateMap) -> BankRead:
    accounts = [account_read(a, rates) for a in bank.accounts]
    out = BankRead.model_validate(bank)
    out.accounts = accounts
    out.total_converted = quantize_money(sum((_signed(a) for a in accounts), ZERO))
    out.converted_currency = settings.base_currency
    return out


def expense_read(expense: Expense, rates: RateMap, today: date | None = None) -> ExpenseRead:
    today = today or date.today()
    out = ExpenseRead.model_validate(expense)
    converted = convert(expense.amount, expense.currency, rates)
    out.converted_amount = converted
    out.converted_currency = settings.base_currency
    out.rate_available = converted is not None
    out.is_overdue = (
        expense.status == "pending" and expense.due_date is not None and expense.due_date < today
    )
    return out


def expense_group_read(
    group: ExpenseGroup, rates: RateMap, today: date | None = None
) -> ExpenseGroupRead:
    items = [expense_read(e, rates, today) for e in group.expenses]
    out = ExpenseGroupRead.model_validate(group)
    out.expenses = items
    out.converted_currency = settings.base_currency

    live = [i for i in items if i.status != "cancelled"]
    paid = [i for i in live if i.status == "paid"]
    out.total_converted = quantize_money(sum((Decimal(i.converted_amount or 0) for i in live), ZERO))
    out.paid_converted = quantize_money(sum((Decimal(i.converted_amount or 0) for i in paid), ZERO))
    out.outstanding_converted = quantize_money(
        Decimal(out.total_converted) - Decimal(out.paid_converted)
    )
    out.expense_count = len(live)
    out.paid_count = len(paid)
    return out


def income_read(income: Income, rates: RateMap, today: date | None = None) -> IncomeRead:
    today = today or date.today()
    out = IncomeRead.model_validate(income)
    converted = convert(income.amount, income.currency, rates)
    out.converted_amount = converted
    out.converted_currency = settings.base_currency
    out.rate_available = converted is not None
    out.is_late = (
        income.status == "expected"
        and income.expected_date is not None
        and income.expected_date < today
    )
    return out


def income_source_read(
    source: IncomeSource, rates: RateMap, today: date | None = None
) -> IncomeSourceRead:
    items = [income_read(i, rates, today) for i in source.incomes]
    out = IncomeSourceRead.model_validate(source)
    out.incomes = items
    out.converted_currency = settings.base_currency

    live = [i for i in items if i.status != "cancelled"]
    received = [i for i in live if i.status == "received"]
    out.total_converted = quantize_money(sum((Decimal(i.converted_amount or 0) for i in live), ZERO))
    out.received_converted = quantize_money(
        sum((Decimal(i.converted_amount or 0) for i in received), ZERO)
    )
    out.expected_converted = quantize_money(
        Decimal(out.total_converted) - Decimal(out.received_converted)
    )
    out.income_count = len(live)
    out.received_count = len(received)
    return out
