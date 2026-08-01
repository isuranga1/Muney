from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class FeedGroup(TimestampMixin, Base):
    """A user-created bundle of feeds, e.g. 'Sri Lanka business' or 'Markets'."""

    __tablename__ = "feed_groups"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    description: Mapped[str | None] = mapped_column(Text)
    color: Mapped[str | None] = mapped_column(String(9))
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    feeds: Mapped[list["Feed"]] = relationship(
        back_populates="group",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="Feed.sort_order, Feed.id",
    )


class Feed(TimestampMixin, Base):
    """One RSS/Atom source."""

    __tablename__ = "feeds"

    id: Mapped[int] = mapped_column(primary_key=True)
    group_id: Mapped[int | None] = mapped_column(
        ForeignKey("feed_groups.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    url: Mapped[str] = mapped_column(String(1000), nullable=False)
    site_url: Mapped[str | None] = mapped_column(String(1000))
    notes: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Outcome of the most recent fetch, so a silently dead feed is visible in
    # the UI instead of just quietly never producing articles.
    last_fetched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_status: Mapped[str | None] = mapped_column(String(20))  # ok | error
    last_error: Mapped[str | None] = mapped_column(String(500))

    group: Mapped[FeedGroup | None] = relationship(back_populates="feeds")
    articles: Mapped[list["Article"]] = relationship(
        back_populates="feed",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class Article(TimestampMixin, Base):
    """A single item pulled from a feed."""

    __tablename__ = "articles"
    __table_args__ = (
        # Dedupe within a feed. Hashed because a Google News link can run to
        # hundreds of characters, which risks blowing the btree index limit.
        UniqueConstraint("feed_id", "guid_hash", name="uq_articles_feed_guid"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    feed_id: Mapped[int] = mapped_column(
        ForeignKey("feeds.id", ondelete="CASCADE"), index=True, nullable=False
    )
    guid_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    link: Mapped[str] = mapped_column(String(2000), nullable=False)
    summary: Mapped[str | None] = mapped_column(Text)
    author: Mapped[str | None] = mapped_column(String(200))
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    is_saved: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)

    feed: Mapped[Feed] = relationship(back_populates="articles")
