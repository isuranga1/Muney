"""Monthly and yearly figures, and the percentage-rule check.

Everything is summed from `Transaction.base_amount` — the base-currency value
frozen when the transaction was recorded — so a past month's totals don't move
when exchange rates do. Transfers are never income or spending; they only
count toward budget buckets (money moved into an emergency-fund account is
money saved).
"""

from __future__ import annotations

import calendar
from collections import defaultdict
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import Account, BudgetBucket, BudgetMonth, Category, Transaction
from app.schemas.finance import (
    BucketStatus,
    BudgetMonthStatus,
    CategoryTotal,
    CategoryYearRow,
    DayTotal,
    MonthReport,
    MonthTotal,
    YearReport,
)
from app.services.fx import get_rate_map, quantize_money

ZERO = Decimal("0.00")


def month_bounds(year: int, month: int) -> tuple[date, date]:
    return date(year, month, 1), date(year, month, calendar.monthrange(year, month)[1])


def previous_month(year: int, month: int) -> tuple[int, int]:
    return (year - 1, 12) if month == 1 else (year, month - 1)


def _transactions(db: Session, start: date, end: date) -> list[Transaction]:
    return list(
        db.scalars(
            select(Transaction).where(
                Transaction.occurred_on >= start, Transaction.occurred_on <= end
            )
        ).all()
    )


def _value(txn: Transaction) -> Decimal:
    return Decimal(txn.base_amount) if txn.base_amount is not None else ZERO


def _categories(db: Session) -> dict[int, Category]:
    return {c.id: c for c in db.scalars(select(Category)).all()}


def _category_totals(
    txns: list[Transaction], kind: str, categories: dict[int, Category]
) -> list[CategoryTotal]:
    totals: dict[int | None, list] = defaultdict(lambda: [ZERO, 0])
    for txn in txns:
        if txn.kind == kind:
            totals[txn.category_id][0] += _value(txn)
            totals[txn.category_id][1] += 1
    grand = sum((t[0] for t in totals.values()), ZERO)
    rows = []
    for category_id, (total, count) in totals.items():
        category = categories.get(category_id) if category_id is not None else None
        rows.append(
            CategoryTotal(
                category_id=category_id,
                name=category.name if category else "Uncategorised",
                icon=category.icon if category else None,
                color=category.color if category else None,
                total=quantize_money(total),
                count=count,
                share=float(total / grand * 100) if grand else 0.0,
            )
        )
    return sorted(rows, key=lambda r: r.total, reverse=True)


def _sum(txns: list[Transaction], kind: str) -> Decimal:
    return sum((_value(t) for t in txns if t.kind == kind), ZERO)


# -------------------------------------------------------------------- month


def month_report(db: Session, year: int, month: int) -> MonthReport:
    start, end = month_bounds(year, month)
    txns = _transactions(db, start, end)
    categories = _categories(db)

    income, expense = _sum(txns, "income"), _sum(txns, "expense")

    days: dict[date, list[Decimal]] = defaultdict(lambda: [ZERO, ZERO])
    for txn in txns:
        if txn.kind == "income":
            days[txn.occurred_on][0] += _value(txn)
        elif txn.kind == "expense":
            days[txn.occurred_on][1] += _value(txn)

    prev_start, prev_end = month_bounds(*previous_month(year, month))
    prev = _transactions(db, prev_start, prev_end)

    secondary = settings.secondary_currency
    if secondary == settings.base_currency:
        secondary = ""
    rate = get_rate_map(db).get(secondary) if secondary else None

    return MonthReport(
        year=year,
        month=month,
        base_currency=settings.base_currency,
        secondary_currency=secondary or None,
        secondary_rate=float(rate) if rate else None,
        income=quantize_money(income),
        expense=quantize_money(expense),
        net=quantize_money(income - expense),
        savings_rate=float((income - expense) / income * 100) if income else None,
        transaction_count=len([t for t in txns if t.kind != "transfer"]),
        expense_by_category=_category_totals(txns, "expense", categories),
        income_by_category=_category_totals(txns, "income", categories),
        by_day=[
            DayTotal(day=day, income=quantize_money(v[0]), expense=quantize_money(v[1]))
            for day, v in sorted(days.items())
        ],
        previous_income=quantize_money(_sum(prev, "income")),
        previous_expense=quantize_money(_sum(prev, "expense")),
    )


# --------------------------------------------------------------------- year


def year_report(db: Session, year: int) -> YearReport:
    txns = _transactions(db, date(year, 1, 1), date(year, 12, 31))
    categories = _categories(db)

    months = []
    for m in range(1, 13):
        in_month = [t for t in txns if t.occurred_on.month == m]
        inc, exp = _sum(in_month, "income"), _sum(in_month, "expense")
        months.append(
            MonthTotal(
                month=m,
                income=quantize_money(inc),
                expense=quantize_money(exp),
                net=quantize_money(inc - exp),
            )
        )

    def matrix(kind: str) -> list[CategoryYearRow]:
        grid: dict[int | None, list[Decimal]] = defaultdict(lambda: [ZERO] * 12)
        for txn in txns:
            if txn.kind == kind:
                grid[txn.category_id][txn.occurred_on.month - 1] += _value(txn)
        rows = []
        for category_id, values in grid.items():
            category = categories.get(category_id) if category_id is not None else None
            rows.append(
                CategoryYearRow(
                    category_id=category_id,
                    name=category.name if category else "Uncategorised",
                    icon=category.icon if category else None,
                    color=category.color if category else None,
                    total=quantize_money(sum(values, ZERO)),
                    months=[quantize_money(v) for v in values],
                )
            )
        return sorted(rows, key=lambda r: r.total, reverse=True)

    income, expense = _sum(txns, "income"), _sum(txns, "expense")
    return YearReport(
        year=year,
        base_currency=settings.base_currency,
        income=quantize_money(income),
        expense=quantize_money(expense),
        net=quantize_money(income - expense),
        months=months,
        expense_categories=matrix("expense"),
        income_categories=matrix("income"),
    )


# ------------------------------------------------------------------- budget


def budget_status(db: Session, year: int, month: int) -> BudgetMonthStatus:
    start, end = month_bounds(year, month)
    txns = _transactions(db, start, end)
    categories = _categories(db)
    account_bucket = {
        a.id: a.bucket_id for a in db.scalars(select(Account)).all() if a.bucket_id is not None
    }
    buckets = list(db.scalars(select(BudgetBucket).order_by(BudgetBucket.sort_order)).all())

    income = _sum(txns, "income")
    override = db.scalar(
        select(BudgetMonth).where(BudgetMonth.year == year, BudgetMonth.month == month)
    )
    basis = Decimal(override.income_basis) if override else income

    actual: dict[int, Decimal] = defaultdict(lambda: ZERO)
    unassigned = ZERO
    for txn in txns:
        value = _value(txn)
        if txn.kind == "expense":
            category = categories.get(txn.category_id) if txn.category_id else None
            if category and category.bucket_id:
                actual[category.bucket_id] += value
            else:
                unassigned += value
        elif txn.kind == "transfer":
            into = account_bucket.get(txn.to_account_id)
            out_of = account_bucket.get(txn.account_id)
            # Moving money between two accounts of the same bucket is a wash.
            if into != out_of:
                if into:
                    actual[into] += value
                if out_of:
                    actual[out_of] -= value

    statuses = []
    for bucket in buckets:
        target = basis * Decimal(bucket.percent) / 100
        spent = actual[bucket.id]
        on_track: bool | None = None
        if target > 0:
            on_track = spent >= target if bucket.goal_type == "save" else spent <= target
        statuses.append(
            BucketStatus(
                bucket_id=bucket.id,
                name=bucket.name,
                color=bucket.color,
                goal_type=bucket.goal_type,
                percent=bucket.percent,
                target=quantize_money(target),
                actual=quantize_money(spent),
                progress=float(spent / target * 100) if target > 0 else 0.0,
                on_track=on_track,
                actual_percent=float(spent / basis * 100) if basis > 0 else None,
            )
        )

    return BudgetMonthStatus(
        year=year,
        month=month,
        base_currency=settings.base_currency,
        income_actual=quantize_money(income),
        income_basis=quantize_money(basis),
        basis_is_override=override is not None,
        total_percent=sum((Decimal(b.percent) for b in buckets), ZERO),
        buckets=statuses,
        unassigned_spend=quantize_money(unassigned),
        on_track_count=sum(1 for s in statuses if s.on_track),
    )
