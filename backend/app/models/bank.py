from decimal import Decimal

from sqlalchemy import Boolean, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class Bank(TimestampMixin, Base):
    """A financial institution. Fully user-configurable — add or remove freely."""

    __tablename__ = "banks"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    short_name: Mapped[str | None] = mapped_column(String(40))
    country: Mapped[str | None] = mapped_column(String(60))
    color: Mapped[str | None] = mapped_column(String(9))  # #rrggbb accent for the UI
    notes: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    accounts: Mapped[list["Account"]] = relationship(
        back_populates="bank",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="Account.sort_order, Account.id",
    )


class Account(TimestampMixin, Base):
    """An account held at a bank, in a single currency."""

    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    bank_id: Mapped[int] = mapped_column(
        ForeignKey("banks.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    # savings | current | fixed_deposit | credit_card | investment | wallet | loan | other
    account_type: Mapped[str] = mapped_column(String(32), default="savings", nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    balance: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"), nullable=False)
    account_number: Mapped[str | None] = mapped_column(String(64))
    notes: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Credit cards / loans hold debt: counted as negative toward net worth.
    is_liability: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    bank: Mapped[Bank] = relationship(back_populates="accounts")
