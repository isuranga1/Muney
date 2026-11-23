"""fund entries: money set aside for a bucket without moving it

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-24

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "fund_entries",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("bucket_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=8), nullable=False, server_default="adjust"),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("month", sa.Integer(), nullable=False),
        sa.Column("entry_date", sa.Date(), nullable=False),
        sa.Column("amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("base_amount", sa.Numeric(18, 2), nullable=True),
        sa.Column("note", sa.String(length=200), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["bucket_id"],
            ["budget_buckets.id"],
            name="fk_fund_entries_bucket_id_budget_buckets",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_fund_entries"),
    )
    op.create_index("ix_fund_entries_bucket_id", "fund_entries", ["bucket_id"])


def downgrade() -> None:
    op.drop_index("ix_fund_entries_bucket_id", table_name="fund_entries")
    op.drop_table("fund_entries")
