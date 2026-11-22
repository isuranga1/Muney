from decimal import Decimal

from sqlalchemy import Integer, Numeric, String, UniqueConstraint
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
