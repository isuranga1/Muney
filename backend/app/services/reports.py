"""Monthly and yearly figures, and the percentage-rule check.

Everything is summed from `Transaction.base_amount` — the base-currency value
frozen when the transaction was recorded — so a past month's totals don't move
when exchange rates do. Transfers are never income or spending; they only
count toward budget buckets (money moved into an emergency-fund account is
money saved). So do fund entries: money set aside for a bucket while it stays
in the account it's in.
"""

from __future__ import annotations

import calendar
from collections import defaultdict
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import Account, BudgetBucket, BudgetMonth, Category, FundEntry, Transaction
from app.schemas.finance import (
    BucketStatus,
    BudgetMonthStatus,
    CategoryTotal,
    CategoryYearRow,
    CurrencyEarmark,
    DayTotal,
    FundEntryRead,
    FundHolding,
    FundsOverview,
    FundStatus,
    MonthReport,
    MonthTotal,
    YearReport,
)
from app.services.fx import convert, get_rate_map, quantize_money

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

    secondary = _secondary()
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


def _secondary() -> str:
    code = settings.secondary_currency
    return "" if code == settings.base_currency else code


def _bucket_actuals(
    txns: list[Transaction], categories: dict[int, Category], account_bucket: dict[int, int]
) -> tuple[dict[int, Decimal], Decimal]:
    """What each bucket used in these transactions, and spending in no bucket."""
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
    return actual, unassigned


def _on_track(goal_type: str, actual: Decimal, target: Decimal) -> bool | None:
    if target <= 0:
        return None
    return actual >= target if goal_type == "save" else actual <= target


def budget_status(db: Session, year: int, month: int) -> BudgetMonthStatus:
    start, end = month_bounds(year, month)
    txns = _transactions(db, start, end)
    account_bucket = {
        a.id: a.bucket_id for a in db.scalars(select(Account)).all() if a.bucket_id is not None
    }
    buckets = list(db.scalars(select(BudgetBucket).order_by(BudgetBucket.sort_order)).all())
    allocations = {
        e.bucket_id: e
        for e in db.scalars(
            select(FundEntry).where(
                FundEntry.kind == "monthly", FundEntry.year == year, FundEntry.month == month
            )
        ).all()
    }

    income = _sum(txns, "income")
    override = db.scalar(
        select(BudgetMonth).where(BudgetMonth.year == year, BudgetMonth.month == month)
    )
    basis = Decimal(override.income_basis) if override else income
    actual, unassigned = _bucket_actuals(txns, _categories(db), account_bucket)

    statuses = []
    for bucket in buckets:
        target = basis * Decimal(bucket.percent) / 100
        spent = actual[bucket.id]
        # A ticked allocation is money saved, even though it never left the account.
        allocation = allocations.get(bucket.id) if bucket.goal_type == "save" else None
        if allocation is not None:
            spent += Decimal(allocation.base_amount or 0)
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
                on_track=_on_track(bucket.goal_type, spent, target),
                actual_percent=float(spent / basis * 100) if basis > 0 else None,
                allocation=FundEntryRead.model_validate(allocation) if allocation else None,
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
        secondary_currency=_secondary() or None,
        rates={code: float(rate) for code, rate in get_rate_map(db).items()},
    )


# -------------------------------------------------------------------- funds


class _Fund:
    def __init__(self) -> None:
        self.holdings: dict[str, Decimal] = defaultdict(lambda: ZERO)
        self.put_in = ZERO
        self.taken_out = ZERO
        self.goal = ZERO
        self.met = 0
        self.counted = 0
        self.this_target = ZERO
        self.this_actual = ZERO

    def add(self, base_value: Decimal) -> None:
        if base_value >= 0:
            self.put_in += base_value
        else:
            self.taken_out -= base_value


def fund_overview(db: Session) -> FundsOverview:
    """Every bucket's running balance, from the first month with any data to now.

    Saving buckets hold real money: ticked allocations and top-ups in the
    currency they sit in, plus spending in their categories and transfers into
    their accounts. Their balance is those holdings at today's rates, so a fund
    kept in USD grows in LKR when the rupee weakens.

    Spending buckets are envelopes: each month adds its budget, spending takes
    it away, and whatever wasn't spent carries forward.
    """
    today = date.today()
    current = (today.year, today.month)
    base = settings.base_currency
    rates = get_rate_map(db)

    txns = list(db.scalars(select(Transaction).where(Transaction.occurred_on <= today)).all())
    categories = _categories(db)
    accounts = {a.id: a for a in db.scalars(select(Account)).all()}
    account_bucket = {a.id: a.bucket_id for a in accounts.values() if a.bucket_id is not None}
    buckets = list(db.scalars(select(BudgetBucket).order_by(BudgetBucket.sort_order)).all())
    saving = {b.id for b in buckets if b.goal_type == "save"}
    overrides = {
        (row.year, row.month): Decimal(row.income_basis)
        for row in db.scalars(select(BudgetMonth)).all()
    }
    entries = list(db.scalars(select(FundEntry)).all())
    monthly = {(e.bucket_id, e.year, e.month): e for e in entries if e.kind == "monthly"}

    seen = [(t.occurred_on.year, t.occurred_on.month) for t in txns]
    seen += [(e.year, e.month) for e in entries] + list(overrides)
    start = min([m for m in seen if m <= current], default=current)

    by_month: dict[tuple[int, int], list[Transaction]] = defaultdict(list)
    for txn in txns:
        by_month[(txn.occurred_on.year, txn.occurred_on.month)].append(txn)

    funds = {b.id: _Fund() for b in buckets}

    # Month by month: targets, goal checks, and the spending envelopes.
    year, month = start
    while (year, month) <= current:
        in_month = by_month.get((year, month), [])
        basis = overrides.get((year, month), _sum(in_month, "income"))
        actual, _ = _bucket_actuals(in_month, categories, account_bucket)
        for bucket in buckets:
            fund = funds[bucket.id]
            target = basis * Decimal(bucket.percent) / 100
            used = actual[bucket.id]
            if bucket.id in saving:
                entry = monthly.get((bucket.id, year, month))
                if entry is not None:
                    used += Decimal(entry.base_amount or 0)
            else:
                fund.put_in += target
                fund.taken_out += used
            fund.goal += target
            check = _on_track(bucket.goal_type, used, target)
            if check is not None:
                fund.counted += 1
                fund.met += int(check)
            if (year, month) == current:
                fund.this_target, fund.this_actual = target, used
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)

    # What saving buckets actually hold, in the currency it's held in.
    def leg(account_id: int | None, delta, value: Decimal) -> tuple[str, Decimal]:
        account = accounts.get(account_id) if account_id else None
        if account is None or delta is None:
            return base, value
        return account.currency, abs(Decimal(delta))

    for txn in txns:
        value = _value(txn)
        if txn.kind == "expense":
            category = categories.get(txn.category_id) if txn.category_id else None
            if category and category.bucket_id in saving:
                funds[category.bucket_id].holdings[txn.currency] += Decimal(txn.amount)
                funds[category.bucket_id].add(value)
        elif txn.kind == "transfer":
            into = account_bucket.get(txn.to_account_id)
            out_of = account_bucket.get(txn.account_id)
            if into == out_of:
                continue
            if into in saving:
                code, amount = leg(txn.to_account_id, txn.to_account_delta, value)
                funds[into].holdings[code] += amount
                funds[into].add(value)
            if out_of in saving:
                code, amount = leg(txn.account_id, txn.account_delta, value)
                funds[out_of].holdings[code] -= amount
                funds[out_of].add(-value)

    # Entries are money promised to a fund but still sitting in your accounts.
    set_aside: dict[str, Decimal] = defaultdict(lambda: ZERO)
    for entry in entries:
        fund = funds.get(entry.bucket_id)
        if fund is None or (entry.kind == "monthly" and entry.bucket_id not in saving):
            continue
        fund.add(Decimal(entry.base_amount or 0))
        if entry.bucket_id in saving:
            fund.holdings[entry.currency] += Decimal(entry.amount)
            set_aside[entry.currency] += Decimal(entry.amount)

    out = []
    for bucket in buckets:
        fund = funds[bucket.id]
        if bucket.id in saving:
            holdings = [
                FundHolding(
                    currency=code,
                    amount=quantize_money(amount),
                    base_value=convert(amount, code, rates),
                )
                for code, amount in sorted(fund.holdings.items(), key=lambda kv: kv[0] != base)
                if quantize_money(amount) != 0
            ]
            balance = sum((h.base_value for h in holdings if h.base_value is not None), ZERO)
        else:
            balance = quantize_money(fund.put_in - fund.taken_out)
            holdings = [FundHolding(currency=base, amount=balance, base_value=balance)]
        out.append(
            FundStatus(
                bucket_id=bucket.id,
                name=bucket.name,
                color=bucket.color,
                goal_type=bucket.goal_type,
                percent=bucket.percent,
                balance=quantize_money(balance),
                holdings=holdings,
                put_in=quantize_money(fund.put_in),
                taken_out=quantize_money(fund.taken_out),
                goal_to_date=quantize_money(fund.goal),
                months_met=fund.met,
                months_counted=fund.counted,
                this_month_target=quantize_money(fund.this_target),
                this_month_actual=quantize_money(fund.this_actual),
                allocated_this_month=(
                    (bucket.id, *current) in monthly if bucket.id in saving else None
                ),
            )
        )

    in_accounts: dict[str, Decimal] = defaultdict(lambda: ZERO)
    for account in accounts.values():
        if account.include_in_total and not account.is_archived and not account.is_liability:
            in_accounts[account.currency] += Decimal(account.balance)
    earmarks = [
        CurrencyEarmark(
            currency=code,
            in_accounts=quantize_money(in_accounts[code]),
            set_aside=quantize_money(set_aside[code]),
            free=quantize_money(in_accounts[code] - set_aside[code]),
        )
        for code in sorted(set_aside, key=lambda c: c != base)
        if quantize_money(set_aside[code]) != 0
    ]

    secondary = _secondary()
    rate = rates.get(secondary) if secondary else None
    return FundsOverview(
        base_currency=base,
        secondary_currency=secondary or None,
        secondary_rate=float(rate) if rate else None,
        since_year=start[0],
        since_month=start[1],
        funds=out,
        total=quantize_money(sum((f.balance for f in out), ZERO)),
        earmarks=earmarks,
    )
