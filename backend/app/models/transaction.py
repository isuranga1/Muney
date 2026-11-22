from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Transaction(TimestampMixin, Base):
    """Money in, money out, or money moved between your own accounts.

    kind:
        expense  — out of `account_id`
        income   — into `account_id`
        transfer — out of `account_id`, into `to_account_id`; excluded from
                   income/expense totals, but counts toward the destination
                   account's budget bucket (that's how "saved 20%" is measured
                   when you save by moving money to a separate account).

    `base_amount` is the amount in the base currency at the rate on the day it
    was recorded, so last year's reports don't shift every time LKR moves.

    `account_delta` / `to_account_delta` are exactly what was added to each
    balance, in that account's currency. Editing or deleting reverses them.
    """

    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    base_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    occurred_on: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    # Exact time, when the SMS printed one.
    occurred_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    account_id: Mapped[int | None] = mapped_column(
        ForeignKey("accounts.id", ondelete="SET NULL"), index=True
    )
    account_delta: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    to_account_id: Mapped[int | None] = mapped_column(
        ForeignKey("accounts.id", ondelete="SET NULL"), index=True
    )
    to_account_delta: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))

    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL"), index=True
    )
    merchant: Mapped[str | None] = mapped_column(String(120))
    note: Mapped[str | None] = mapped_column(Text)

    # manual | sms
    source: Mapped[str] = mapped_column(String(8), default="manual", nullable=False)
    # user | rule | keyword | llm — how the category was chosen, or null.
    categorized_by: Mapped[str | None] = mapped_column(String(8))


class TransactionMessage(TimestampMixin, Base):
    """A raw bank SMS forwarded from the phone, kept verbatim.

    status:
        queued    — stored, waiting for the background processor
        pending   — nothing could read it; record it by hand from the inbox
        processed — became `transaction_id`
        ignored   — not a transaction (OTP, promo), or dismissed
        failed    — reading it raised; `error` says why
    """

    __tablename__ = "transaction_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    sender: Mapped[str | None] = mapped_column(String(120))
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    body_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(10), default="queued", nullable=False, index=True)
    # regex | llm | manual — what read it.
    parsed_by: Mapped[str | None] = mapped_column(String(8))
    error: Mapped[str | None] = mapped_column(String(500))
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    transaction_id: Mapped[int | None] = mapped_column(
        ForeignKey("transactions.id", ondelete="SET NULL"), index=True
    )
