"""news: feed groups, feeds and articles

Revision ID: 0003
Revises: 0002
Create Date: 2026-08-01

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "feed_groups",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("color", sa.String(length=9), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("id", name="pk_feed_groups"),
        sa.UniqueConstraint("name", name="uq_feed_groups_name"),
    )

    op.create_table(
        "feeds",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("group_id", sa.Integer(), nullable=True),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("url", sa.String(length=1000), nullable=False),
        sa.Column("site_url", sa.String(length=1000), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("last_fetched_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_status", sa.String(length=20), nullable=True),
        sa.Column("last_error", sa.String(length=500), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("id", name="pk_feeds"),
        sa.ForeignKeyConstraint(
            ["group_id"],
            ["feed_groups.id"],
            name="fk_feeds_group_id_feed_groups",
            ondelete="CASCADE",
        ),
    )
    op.create_index("ix_feeds_group_id", "feeds", ["group_id"])

    op.create_table(
        "articles",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("feed_id", sa.Integer(), nullable=False),
        sa.Column("guid_hash", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("link", sa.String(length=2000), nullable=False),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("author", sa.String(length=200), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("is_read", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_saved", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("id", name="pk_articles"),
        sa.ForeignKeyConstraint(
            ["feed_id"], ["feeds.id"], name="fk_articles_feed_id_feeds", ondelete="CASCADE"
        ),
        sa.UniqueConstraint("feed_id", "guid_hash", name="uq_articles_feed_guid"),
    )
    op.create_index("ix_articles_feed_id", "articles", ["feed_id"])
    op.create_index("ix_articles_published_at", "articles", ["published_at"])
    op.create_index("ix_articles_is_read", "articles", ["is_read"])
    op.create_index("ix_articles_is_saved", "articles", ["is_saved"])


def downgrade() -> None:
    op.drop_table("articles")
    op.drop_table("feeds")
    op.drop_table("feed_groups")
