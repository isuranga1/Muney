from sqlalchemy import Boolean, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Category(TimestampMixin, Base):
    """What a transaction was for. Expense and income categories are separate lists."""

    __tablename__ = "categories"
    __table_args__ = (UniqueConstraint("kind", "name", name="uq_categories_kind_name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    kind: Mapped[str] = mapped_column(String(8), nullable=False)  # expense | income
    icon: Mapped[str | None] = mapped_column(String(16))  # an emoji
    color: Mapped[str | None] = mapped_column(String(9))
    # Comma-separated, case-insensitive. Cheap first pass before any LLM call.
    keywords: Mapped[str | None] = mapped_column(Text)
    # Expense categories only: which slice of the monthly rule this spend uses.
    bucket_id: Mapped[int | None] = mapped_column(
        ForeignKey("budget_buckets.id", ondelete="SET NULL"), index=True
    )
    # system (seeded) | user | llm — llm ones are flagged in the UI for review.
    origin: Mapped[str] = mapped_column(String(8), default="user", nullable=False)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    @property
    def keyword_list(self) -> list[str]:
        return [k.strip().lower() for k in (self.keywords or "").split(",") if k.strip()]


class MerchantRule(TimestampMixin, Base):
    """Learned "this merchant -> this category", written whenever you recategorise.

    Checked before keywords and the LLM, so correcting one PickMe ride files
    every later one correctly without another model call.
    """

    __tablename__ = "merchant_rules"

    id: Mapped[int] = mapped_column(primary_key=True)
    merchant_key: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    category_id: Mapped[int] = mapped_column(
        ForeignKey("categories.id", ondelete="CASCADE"), index=True, nullable=False
    )
