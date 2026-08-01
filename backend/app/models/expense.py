from datetime import date
from decimal import Decimal

from sqlalchemy import Boolean, Date, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class ExpenseGroup(TimestampMixin, Base):
    """A user-created bucket of expenses, e.g. 'Monthly bills' or 'Trip to Japan'."""

    __tablename__ = "expense_groups"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    description: Mapped[str | None] = mapped_column(Text)
    color: Mapped[str | None] = mapped_column(String(9))
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    expenses: Mapped[list["Expense"]] = relationship(
        back_populates="group",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="Expense.due_date, Expense.id",
    )


class Expense(TimestampMixin, Base):
    __tablename__ = "expenses"

    id: Mapped[int] = mapped_column(primary_key=True)
    group_id: Mapped[int | None] = mapped_column(
        ForeignKey("expense_groups.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    # pending | paid | cancelled  (overdue is derived from due_date, never stored)
    status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False, index=True)
    due_date: Mapped[date | None] = mapped_column(Date, index=True)
    paid_date: Mapped[date | None] = mapped_column(Date)
    # none | weekly | monthly | quarterly | yearly
    recurrence: Mapped[str] = mapped_column(String(16), default="none", nullable=False)
    # Account the money left from — kept if the account is deleted.
    account_id: Mapped[int | None] = mapped_column(
        ForeignKey("accounts.id", ondelete="SET NULL"), index=True
    )
    vendor: Mapped[str | None] = mapped_column(String(120))
    notes: Mapped[str | None] = mapped_column(Text)

    group: Mapped[ExpenseGroup | None] = relationship(back_populates="expenses")
