from datetime import date
from decimal import Decimal

from sqlalchemy import Date, ForeignKey, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class BudgetBucket(TimestampMixin, Base):
    """One slice of the monthly percentage rule — "20% to the emergency fund".

    Each bucket is an envelope. Every month it receives income x percent,
    spending in the categories mapped to it comes out, and whatever is left
    carries into the next month. A negative balance means it's overspent.

    goal_type only changes how it's shown:
        save  — a fund that builds up (emergency fund, investment)
        spend — a monthly allowance   (daily expenses, carefree)
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


class BudgetShare(Base):
    """A past month's percentage for one bucket, frozen when the rule changes.

    Editing the rule applies from the current month on: before any bucket is
    added, changed or removed, every finished month that has no rows yet gets
    the percentages it was using. Months without rows use the live rule.
    """

    __tablename__ = "budget_shares"
    __table_args__ = (
        UniqueConstraint("year", "month", "bucket_id", name="uq_budget_shares_year_month_bucket"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    bucket_id: Mapped[int] = mapped_column(
        ForeignKey("budget_buckets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)


class FundMove(TimestampMixin, Base):
    """Money moved between buckets, or into or out of one, in base currency.

    from and to both set — covering an overspent bucket from another one
    only to       — money added: an opening balance or a top-up
    only from     — money taken out for something outside the bucket's categories

    The percentages never change; only the balances do. Deleting a bucket
    nulls its side, so a move out of it becomes money added to the other.
    """

    __tablename__ = "fund_moves"

    id: Mapped[int] = mapped_column(primary_key=True)
    moved_on: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    from_bucket_id: Mapped[int | None] = mapped_column(
        ForeignKey("budget_buckets.id", ondelete="SET NULL"), index=True
    )
    to_bucket_id: Mapped[int | None] = mapped_column(
        ForeignKey("budget_buckets.id", ondelete="SET NULL"), index=True
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    note: Mapped[str | None] = mapped_column(String(200))
