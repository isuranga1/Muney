"""Aggregates for the board's landing page.

Every figure is expressed in the base currency (LKR by default). Rows whose
currency has no rate are skipped from the totals and reported back in
`unconvertible_currencies` so the UI can say so out loud rather than quietly
undercounting.
"""

import calendar
from collections import defaultdict
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Query
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.deps import CurrentUser, DbSession
from app.core.config import settings
from app.models import Account, Bank, Expense, ExpenseGroup, Income
from app.schemas.dashboard import (
    BankBreakdown,
    CurrencyBreakdown,
    DashboardSummary,
    GroupBreakdown,
    PeriodSummary,
)
from app.services.fx import convert, get_rate_map, is_stale, quantize_money

router = APIRouter(tags=["dashboard"])

ZERO = Decimal("0.00")


def _month_bounds(year: int | None, month: int | None) -> tuple[date, date]:
    today = date.today()
    year = year or today.year
    month = month or today.month
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, 1), date(year, month, last_day)


@router.get("/dashboard", response_model=DashboardSummary)
def dashboard(
    db: DbSession,
    current_user: CurrentUser,
    year: int | None = Query(default=None, ge=1970, le=2999),
    month: int | None = Query(default=None, ge=1, le=12),
) -> DashboardSummary:
    rates = get_rate_map(db)
    today = date.today()
    period_start, period_end = _month_bounds(year, month)
    unconvertible: set[str] = set()

    def to_base(amount: Decimal, currency: str) -> Decimal | None:
        value = convert(amount, currency, rates)
        if value is None:
            unconvertible.add(currency.upper())
        return value

    # ---------------------------------------------------------- net worth
    banks = db.scalars(select(Bank).options(selectinload(Bank.accounts))).all()
    accounts = [a for bank in banks for a in bank.accounts if a.is_active]

    assets = ZERO
    liabilities = ZERO
    per_currency: dict[str, dict] = defaultdict(
        lambda: {"original": ZERO, "converted": ZERO, "count": 0, "rate_available": True}
    )
    per_bank: dict[int, Decimal] = defaultdict(lambda: ZERO)
    per_bank_count: dict[int, int] = defaultdict(int)

    for account in accounts:
        code = account.currency.upper()
        bucket = per_currency[code]
        bucket["count"] += 1
        signed_original = -Decimal(account.balance) if account.is_liability else Decimal(account.balance)
        bucket["original"] += signed_original

        converted = to_base(account.balance, code)
        if converted is None:
            bucket["rate_available"] = False
            continue

        bucket["converted"] += -converted if account.is_liability else converted
        per_bank[account.bank_id] += -converted if account.is_liability else converted
        per_bank_count[account.bank_id] += 1
        if account.is_liability:
            liabilities += converted
        else:
            assets += converted

    by_currency = [
        CurrencyBreakdown(
            currency=code,
            original_total=quantize_money(data["original"]),
            converted_total=quantize_money(data["converted"]),
            account_count=data["count"],
            rate_available=data["rate_available"],
        )
        for code, data in sorted(per_currency.items())
    ]

    by_bank = sorted(
        (
            BankBreakdown(
                bank_id=bank.id,
                bank_name=bank.name,
                color=bank.color,
                converted_total=quantize_money(per_bank[bank.id]),
                account_count=per_bank_count[bank.id],
            )
            for bank in banks
            if per_bank_count[bank.id] > 0
        ),
        key=lambda b: b.converted_total,
        reverse=True,
    )

    # ------------------------------------------------------ expenses view
    groups = {g.id: g for g in db.scalars(select(ExpenseGroup)).all()}
    expenses = db.scalars(select(Expense).where(Expense.status != "cancelled")).all()

    group_totals: dict[int | None, dict] = defaultdict(
        lambda: {"total": ZERO, "paid": ZERO}
    )
    overdue_total = ZERO
    overdue_count = 0
    expenses_paid_period = ZERO
    expenses_outstanding_period = ZERO

    for expense in expenses:
        converted = to_base(expense.amount, expense.currency)
        if converted is None:
            continue

        bucket = group_totals[expense.group_id]
        bucket["total"] += converted
        if expense.status == "paid":
            bucket["paid"] += converted
            if expense.paid_date and period_start <= expense.paid_date <= period_end:
                expenses_paid_period += converted
        else:
            if expense.due_date and period_start <= expense.due_date <= period_end:
                expenses_outstanding_period += converted
            if expense.due_date and expense.due_date < today:
                overdue_total += converted
                overdue_count += 1

    expenses_by_group = sorted(
        (
            GroupBreakdown(
                group_id=group_id,
                group_name=groups[group_id].name if group_id in groups else "Ungrouped",
                color=groups[group_id].color if group_id in groups else None,
                converted_total=quantize_money(data["total"]),
                paid_converted=quantize_money(data["paid"]),
                outstanding_converted=quantize_money(data["total"] - data["paid"]),
            )
            for group_id, data in group_totals.items()
        ),
        key=lambda g: g.converted_total,
        reverse=True,
    )

    # -------------------------------------------------------- income view
    incomes = db.scalars(select(Income).where(Income.status != "cancelled")).all()
    income_received = ZERO
    income_expected = ZERO

    for income in incomes:
        converted = to_base(income.amount, income.currency)
        if converted is None:
            continue
        if income.status == "received":
            if income.received_date and period_start <= income.received_date <= period_end:
                income_received += converted
        elif income.expected_date and period_start <= income.expected_date <= period_end:
            income_expected += converted

    this_month = PeriodSummary(
        period_start=period_start,
        period_end=period_end,
        income_received=quantize_money(income_received),
        income_expected=quantize_money(income_expected),
        expenses_paid=quantize_money(expenses_paid_period),
        expenses_outstanding=quantize_money(expenses_outstanding_period),
        net_actual=quantize_money(income_received - expenses_paid_period),
        net_projected=quantize_money(
            income_received + income_expected - expenses_paid_period - expenses_outstanding_period
        ),
    )

    return DashboardSummary(
        base_currency=settings.base_currency,
        fx_is_stale=is_stale(db),
        assets_total=quantize_money(assets),
        liabilities_total=quantize_money(liabilities),
        net_worth=quantize_money(assets - liabilities),
        account_count=len(accounts),
        bank_count=len([b for b in banks if not b.is_archived]),
        by_currency=by_currency,
        by_bank=by_bank,
        expenses_by_group=expenses_by_group,
        this_month=this_month,
        overdue_total=quantize_money(overdue_total),
        overdue_count=overdue_count,
        unconvertible_currencies=sorted(unconvertible),
    )
