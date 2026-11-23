from datetime import date
from decimal import Decimal

from sqlalchemy import Date, ForeignKey, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class BudgetBucket(TimestampMixin, Base):
    """One slice of the monthly percentage rule — "20% to the emergency fund".

    Each month, target = that month's income x percent. What counts toward a
    bucket is spending in the categories mapped to it, plus transfers into the
    accounts mapped to it (e.g. moving money into an emergency-fund account).

    goal_type decides what "on track" means:
        save  — reach at least the target   (emergency fund, investment)
        spend — stay at or under the target (daily expenses, carefree)
    """

    __tablename__ = "budget_buckets"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(60), nullable=False, unique=True)
    percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    goal_type: Mapped[str] = mapped_column(String(8), nullable=False, default="spend")
    color: Mapped[str | None] = mapped_column(String(9))
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class BudgetMonth(TimestampMixin, Base):
    """Per-month override of the income the percentages apply to.

    Without a row, the basis is the income actually recorded that month. A row
    lets you plan against your expected salary before it lands.
    """

    __tablename__ = "budget_months"
    __table_args__ = (UniqueConstraint("year", "month", name="uq_budget_months_year_month"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    income_basis: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)


class FundEntry(TimestampMixin, Base):
    """Money set aside for a bucket while it stays where it is.

    A salary lands in a USD account and mostly stays there; "this month's 20%
    to the emergency fund" is then a promise, not a transfer. An entry records
    that promise in the currency it's held in, with its base-currency value
    frozen on the day, like a transaction's.

    kind:
        monthly — the month's ticked allocation; one per bucket and month, and
                  it counts toward that month's goal
        adjust  — anything else: an opening balance, an extra top-up, or a
                  negative amount when you spend from the fund. Changes the
                  fund's balance, never a month's goal check.
    """

    __tablename__ = "fund_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    bucket_id: Mapped[int] = mapped_column(
        ForeignKey("budget_buckets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(8), nullable=False, default="adjust")
    # The month it belongs to; for `adjust`, the month of entry_date.
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    entry_date: Mapped[date] = mapped_column(Date, nullable=False)
    # Signed: only `adjust` entries go negative.
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    base_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    note: Mapped[str | None] = mapped_column(String(200))
