"""Monthly and yearly figures, and the percentage-rule check.

Everything is summed from `Transaction.base_amount` — the base-currency value
frozen when the transaction was recorded — so a past month's totals don't move
when exchange rates do. Transfers are never income or spending, and never
touch the budget: buckets are envelopes on paper, so the money can stay in
whichever account it landed in.
"""

from __future__ import annotations

import calendar
from collections import defaultdict
from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import (
    BudgetBucket,
    BudgetMonth,
    BudgetShare,
    Category,
    FundMove,
    Transaction,
)
from app.schemas.finance import (
    BucketMonth,
    BudgetMonthStatus,
    CategoryTotal,
    CategoryYearRow,
    DayTotal,
    FundsOverview,
    FundStatus,
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
#
# Every bucket is an envelope. Each month it receives that month's income x
# its percent, spending in its categories comes out, and what's left carries
# into the next month. Moves cover one bucket from another, or add or take out
# money. One pass from the first month with data computes every month, so the
# month view, the history and the fund balances always agree.


def _secondary() -> str:
    code = settings.secondary_currency
    return "" if code == settings.base_currency else code


def next_month(year: int, month: int) -> tuple[int, int]:
    return (year + 1, 1) if month == 12 else (year, month + 1)


def _ym(day: date) -> tuple[int, int]:
    return day.year, day.month


def first_month(db: Session) -> tuple[int, int] | None:
    """The earliest month anything in the budget can come from."""
    candidates = [
        db.scalar(select(func.min(Transaction.occurred_on))),
        db.scalar(select(func.min(FundMove.moved_on))),
    ]
    months = [_ym(d) for d in candidates if d is not None]
    override = db.execute(
        select(BudgetMonth.year, BudgetMonth.month).order_by(BudgetMonth.year, BudgetMonth.month)
    ).first()
    if override is not None:
        months.append((override[0], override[1]))
    return min(months) if months else None


def freeze_past_shares(db: Session) -> None:
    """Pin every finished month to the percentages it's using right now.

    Called before the rule changes, so the change applies from this month on
    and past balances stay put. Months that already have rows are left alone.
    Doesn't commit.
    """
    start = first_month(db)
    if start is None:
        return
    current = _ym(date.today())
    buckets = list(db.scalars(select(BudgetBucket)).all())
    frozen = {(y, m) for y, m in db.execute(select(BudgetShare.year, BudgetShare.month)).all()}
    ym = start
    while ym < current:
        if ym not in frozen:
            for bucket in buckets:
                db.add(
                    BudgetShare(year=ym[0], month=ym[1], bucket_id=bucket.id, percent=bucket.percent)
                )
        ym = next_month(*ym)
    db.flush()


class _Line:
    __slots__ = ("percent", "opening", "share", "spent", "moved_in", "moved_out")

    def __init__(self, percent: Decimal, opening: Decimal) -> None:
        self.percent = percent
        self.opening = opening
        self.share = ZERO
        self.spent = ZERO
        self.moved_in = ZERO
        self.moved_out = ZERO

    @property
    def available(self) -> Decimal:
        return self.opening + self.share + self.moved_in - self.spent - self.moved_out


class _Month:
    __slots__ = ("income", "basis", "override", "frozen", "unassigned", "lines")

    def __init__(self) -> None:
        self.income = ZERO
        self.basis = ZERO
        self.override = False
        self.frozen = False
        self.unassigned = ZERO
        self.lines: dict[int, _Line] = {}


class Ledger:
    """Every bucket, every month from the first with data through `until`."""

    def __init__(self, db: Session, until: tuple[int, int] | None = None) -> None:
        current = _ym(date.today())
        until = max(until or current, current)
        self.buckets = list(
            db.scalars(select(BudgetBucket).order_by(BudgetBucket.sort_order)).all()
        )
        self.start = min(first_month(db) or current, until)
        last_day = month_bounds(*until)[1]

        txns = _transactions(db, month_bounds(*self.start)[0], last_day)
        categories = _categories(db)
        overrides = {
            (r.year, r.month): Decimal(r.income_basis)
            for r in db.scalars(select(BudgetMonth)).all()
        }
        shares: dict[tuple[int, int], dict[int, Decimal]] = defaultdict(dict)
        for row in db.scalars(select(BudgetShare)).all():
            shares[(row.year, row.month)][row.bucket_id] = Decimal(row.percent)
        live = {b.id: Decimal(b.percent) for b in self.buckets}

        by_month: dict[tuple[int, int], list[Transaction]] = defaultdict(list)
        for txn in txns:
            by_month[_ym(txn.occurred_on)].append(txn)
        moves_by_month: dict[tuple[int, int], list[FundMove]] = defaultdict(list)
        for move in db.scalars(select(FundMove).where(FundMove.moved_on <= last_day)).all():
            moves_by_month[_ym(move.moved_on)].append(move)

        self.months: dict[tuple[int, int], _Month] = {}
        carried = {b.id: ZERO for b in self.buckets}
        ym = self.start
        while ym <= until:
            m = _Month()
            in_month = by_month.get(ym, [])
            m.income = _sum(in_month, "income")
            m.override = ym in overrides
            m.basis = overrides.get(ym, m.income)
            m.frozen = ym in shares
            percents = shares.get(ym, live)
            for bucket in self.buckets:
                line = _Line(percents.get(bucket.id, ZERO), carried[bucket.id])
                line.share = m.basis * line.percent / 100
                m.lines[bucket.id] = line
            for txn in in_month:
                if txn.kind != "expense":
                    continue
                category = categories.get(txn.category_id) if txn.category_id else None
                line = m.lines.get(category.bucket_id) if category and category.bucket_id else None
                if line is not None:
                    line.spent += _value(txn)
                else:
                    m.unassigned += _value(txn)
            for move in moves_by_month.get(ym, []):
                amount = Decimal(move.amount)
                if move.to_bucket_id in m.lines:
                    m.lines[move.to_bucket_id].moved_in += amount
                if move.from_bucket_id in m.lines:
                    m.lines[move.from_bucket_id].moved_out += amount
            carried = {bid: line.available for bid, line in m.lines.items()}
            self.months[ym] = m
            ym = next_month(*ym)

    def month(self, year: int, month: int) -> _Month:
        """A month before the first with data is empty."""
        found = self.months.get((year, month))
        if found is not None:
            return found
        empty = _Month()
        empty.lines = {b.id: _Line(Decimal(b.percent), ZERO) for b in self.buckets}
        return empty

    def balance(self, bucket_id: int) -> Decimal:
        """What the bucket holds now."""
        line = self.month(*_ym(date.today())).lines.get(bucket_id)
        return line.available if line else ZERO


def _secondary_fields(db: Session) -> tuple[str | None, float | None]:
    secondary = _secondary()
    rate = get_rate_map(db).get(secondary) if secondary else None
    return secondary or None, float(rate) if rate else None


def _status(
    ledger: Ledger, year: int, month: int, secondary: tuple[str | None, float | None]
) -> BudgetMonthStatus:
    m = ledger.month(year, month)
    rows = []
    for bucket in ledger.buckets:
        line = m.lines[bucket.id]
        available = quantize_money(line.available)
        rows.append(
            BucketMonth(
                bucket_id=bucket.id,
                name=bucket.name,
                color=bucket.color,
                goal_type=bucket.goal_type,
                percent=line.percent,
                opening=quantize_money(line.opening),
                share=quantize_money(line.share),
                spent=quantize_money(line.spent),
                moved_in=quantize_money(line.moved_in),
                moved_out=quantize_money(line.moved_out),
                available=available,
                used_percent=float(line.spent / m.basis * 100) if m.basis > 0 else None,
                over=available < 0,
            )
        )
    return BudgetMonthStatus(
        year=year,
        month=month,
        base_currency=settings.base_currency,
        secondary_currency=secondary[0],
        secondary_rate=secondary[1],
        income_actual=quantize_money(m.income),
        income_basis=quantize_money(m.basis),
        basis_is_override=m.override,
        total_percent=sum((line.percent for line in m.lines.values()), ZERO),
        rule_frozen=m.frozen,
        buckets=rows,
        unassigned_spend=quantize_money(m.unassigned),
        over_count=sum(1 for r in rows if r.over),
    )


def budget_status(db: Session, year: int, month: int) -> BudgetMonthStatus:
    return _status(Ledger(db, (year, month)), year, month, _secondary_fields(db))


def budget_history(db: Session, months: int) -> list[BudgetMonthStatus]:
    """The last N months, newest first."""
    ledger = Ledger(db)
    secondary = _secondary_fields(db)
    ym = _ym(date.today())
    out = []
    for _ in range(months):
        out.append(_status(ledger, *ym, secondary))
        ym = previous_month(*ym)
    return out


def fund_overview(db: Session) -> FundsOverview:
    """Every bucket's balance today, and what built it."""
    ledger = Ledger(db)
    today = _ym(date.today())
    funds = []
    for bucket in ledger.buckets:
        lines = [m.lines[bucket.id] for ym, m in ledger.months.items() if ym <= today]
        now = ledger.month(*today).lines[bucket.id]
        funds.append(
            FundStatus(
                bucket_id=bucket.id,
                name=bucket.name,
                color=bucket.color,
                goal_type=bucket.goal_type,
                percent=bucket.percent,
                balance=quantize_money(now.available),
                total_share=quantize_money(sum((x.share for x in lines), ZERO)),
                total_spent=quantize_money(sum((x.spent for x in lines), ZERO)),
                moved_in=quantize_money(sum((x.moved_in for x in lines), ZERO)),
                moved_out=quantize_money(sum((x.moved_out for x in lines), ZERO)),
                this_month_share=quantize_money(now.share),
                this_month_spent=quantize_money(now.spent),
            )
        )
    secondary, rate = _secondary_fields(db)
    unassigned = sum((m.unassigned for ym, m in ledger.months.items() if ym <= today), ZERO)
    return FundsOverview(
        base_currency=settings.base_currency,
        secondary_currency=secondary,
        secondary_rate=rate,
        since_year=ledger.start[0],
        since_month=ledger.start[1],
        funds=funds,
        total=quantize_money(sum((f.balance for f in funds), ZERO)),
        unassigned_spend=quantize_money(unassigned),
    )
