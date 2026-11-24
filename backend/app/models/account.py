from decimal import Decimal

from sqlalchemy import Boolean, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin

# Account types that hold debt: a positive balance is money owed.
LIABILITY_TYPES = frozenset({"credit_card", "loan"})


class Account(TimestampMixin, Base):
    """A bank account, card, wallet or cash pile, in exactly one currency.

    `balance` is the live figure. Every transaction moves it by its recorded
    delta (so deleting a transaction puts it back), and an SMS that reports the
    available balance snaps it to the bank's own number.
    """

    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    institution: Mapped[str | None] = mapped_column(String(120))
    # savings | current | credit_card | cash | wallet | investment | fixed_deposit | loan
    account_type: Mapped[str] = mapped_column(String(32), default="savings", nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    balance: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"), nullable=False)
    # The account number, or as many trailing digits as you know. A forwarded
    # SMS finds its account by matching the masked number it shows
    # ("09802XXXXX06", "0980***2106") against this.
    last_digits: Mapped[str | None] = mapped_column(String(32))
    color: Mapped[str | None] = mapped_column(String(9))
    notes: Mapped[str | None] = mapped_column(Text)
    include_in_total: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    @property
    def is_liability(self) -> bool:
        return self.account_type in LIABILITY_TYPES
