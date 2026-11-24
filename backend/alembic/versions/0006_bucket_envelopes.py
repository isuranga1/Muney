"""bucket envelopes: frozen monthly shares and money moved between buckets

Replaces the hand-ticked fund entries. Buckets now fill themselves from each
month's income; `fund_moves` covers an overspent bucket from another, or adds
and takes out money. Opening balances and withdrawals from `fund_entries`
carry over as moves; the monthly ticks are dropped. Accounts no longer map to
a bucket.

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-24

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "budget_shares",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("month", sa.Integer(), nullable=False),
        sa.Column("bucket_id", sa.Integer(), nullable=False),
        sa.Column("percent", sa.Numeric(5, 2), nullable=False),
        sa.ForeignKeyConstraint(
            ["bucket_id"],
            ["budget_buckets.id"],
            name="fk_budget_shares_bucket_id_budget_buckets",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_budget_shares"),
        sa.UniqueConstraint(
            "year", "month", "bucket_id", name="uq_budget_shares_year_month_bucket"
        ),
    )
    op.create_index("ix_budget_shares_bucket_id", "budget_shares", ["bucket_id"])

    op.create_table(
        "fund_moves",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("moved_on", sa.Date(), nullable=False),
        sa.Column("from_bucket_id", sa.Integer(), nullable=True),
        sa.Column("to_bucket_id", sa.Integer(), nullable=True),
        sa.Column("amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("note", sa.String(length=200), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["from_bucket_id"],
            ["budget_buckets.id"],
            name="fk_fund_moves_from_bucket_id_budget_buckets",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["to_bucket_id"],
            ["budget_buckets.id"],
            name="fk_fund_moves_to_bucket_id_budget_buckets",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_fund_moves"),
    )
    op.create_index("ix_fund_moves_moved_on", "fund_moves", ["moved_on"])
    op.create_index("ix_fund_moves_from_bucket_id", "fund_moves", ["from_bucket_id"])
    op.create_index("ix_fund_moves_to_bucket_id", "fund_moves", ["to_bucket_id"])

    # Opening balances and top-ups become money added; withdrawals, money taken out.
    op.execute(
        """
        INSERT INTO fund_moves (moved_on, from_bucket_id, to_bucket_id, amount, note)
        SELECT entry_date,
               CASE WHEN base_amount < 0 THEN bucket_id END,
               CASE WHEN base_amount > 0 THEN bucket_id END,
               ABS(base_amount),
               note
        FROM fund_entries
        WHERE kind = 'adjust' AND base_amount IS NOT NULL AND base_amount <> 0
        """
    )
    op.drop_index("ix_fund_entries_bucket_id", table_name="fund_entries")
    op.drop_table("fund_entries")

    op.drop_index("ix_accounts_bucket_id", table_name="accounts")
    op.drop_constraint("fk_accounts_bucket_id_budget_buckets", "accounts", type_="foreignkey")
    op.drop_column("accounts", "bucket_id")


def downgrade() -> None:
    op.add_column("accounts", sa.Column("bucket_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_accounts_bucket_id_budget_buckets",
        "accounts",
        "budget_buckets",
        ["bucket_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_accounts_bucket_id", "accounts", ["bucket_id"])

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
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["bucket_id"],
            ["budget_buckets.id"],
            name="fk_fund_entries_bucket_id_budget_buckets",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_fund_entries"),
    )
    op.create_index("ix_fund_entries_bucket_id", "fund_entries", ["bucket_id"])

    op.drop_index("ix_fund_moves_to_bucket_id", table_name="fund_moves")
    op.drop_index("ix_fund_moves_from_bucket_id", table_name="fund_moves")
    op.drop_index("ix_fund_moves_moved_on", table_name="fund_moves")
    op.drop_table("fund_moves")
    op.drop_index("ix_budget_shares_bucket_id", table_name="budget_shares")
    op.drop_table("budget_shares")
