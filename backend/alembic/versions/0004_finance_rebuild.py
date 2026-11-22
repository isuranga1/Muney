"""finance rebuild: accounts, transactions, categories, budget rule, SMS inbox

Replaces banks/accounts/expense groups/expenses/income sources/incomes with a
single transactions ledger. THIS DROPS ALL EXISTING FINANCE DATA — users,
FX rates and news are untouched. Back up first (scripts/backup-db.sh).

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-22

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# name, percent, goal_type, color
DEFAULT_BUCKETS = [
    ("Emergency fund", 20, "save", "#2a9d8f"),
    ("Daily expenses", 50, "spend", "#2a78d6"),
    ("Investment", 20, "save", "#7a5cd6"),
    ("Carefree", 10, "spend", "#e0812b"),
]

# name, kind, icon, color, keywords, bucket
DEFAULT_CATEGORIES = [
    ("Groceries", "expense", "🛒", "#2a78d6",
     "keells,cargills,food city,arpico,glomark,spar,laugfs super,supermarket", "Daily expenses"),
    ("Dining out", "expense", "🍽️", "#e0812b",
     "pizza,kfc,mcdonald,burger,cafe,coffee,restaurant,pickme food,uber eats,bakery", "Carefree"),
    ("Transport", "expense", "🚕", "#7a5cd6",
     "pickme,uber,kangaroo,fuel,ceypetco,lanka ioc,parking,highway", "Daily expenses"),
    ("Bills & utilities", "expense", "💡", "#2a9d8f",
     "ceb,leco,water board,nwsdb,dialog,mobitel,slt,hutch,airtel,electricity", "Daily expenses"),
    ("Rent & housing", "expense", "🏠", "#6b7280", "rent,housing", "Daily expenses"),
    ("Health", "expense", "💊", "#4caf50",
     "pharmacy,hospital,asiri,nawaloka,lanka hospitals,osu sala,healthguard,clinic", "Daily expenses"),
    ("Shopping", "expense", "🛍️", "#d64f8a",
     "daraz,amazon,aliexpress,odel,nolimit,fashion bug,cool planet", "Carefree"),
    ("Entertainment", "expense", "🎬", "#c0392b",
     "cinema,scope cinema,pvr,steam,playstation,concert,ticket", "Carefree"),
    ("Subscriptions", "expense", "📺", "#c9a227",
     "netflix,spotify,youtube,apple.com,icloud,google,openai,anthropic", "Carefree"),
    ("Travel", "expense", "✈️", "#1abc9c", "hotel,airline,srilankan,booking.com,airbnb,agoda", "Carefree"),
    ("Education", "expense", "📚", "#3498db", "course,udemy,coursera,tuition,bookshop", "Daily expenses"),
    ("Fees & charges", "expense", "🏦", "#95a5a6", "annual fee,service charge,sms alert", "Daily expenses"),
    ("Emergency fund", "expense", "🛟", "#2a9d8f", None, "Emergency fund"),
    ("Investments", "expense", "📈", "#7a5cd6", "cse,unit trust,shares,binance", "Investment"),
    ("Cash withdrawal", "expense", "💵", "#6b7280", "atm,cash withdrawal", None),
    ("Salary", "income", "💼", "#2a9d8f", "salary,payroll", None),
    ("Freelance", "income", "🧑‍💻", "#2a78d6", "upwork,fiverr,payoneer,freelance", None),
    ("Interest & dividends", "income", "🏦", "#7a5cd6", "interest,dividend", None),
    ("Refunds", "income", "↩️", "#e0812b", "refund,reversal", None),
    ("Other income", "income", "➕", "#6b7280", None, None),
]


def _timestamps() -> list[sa.Column]:
    # Fresh objects per call: a Column can belong to only one table.
    return [
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    ]


def upgrade() -> None:
    # Children before parents.
    for table in ("incomes", "income_sources", "expenses", "expense_groups", "accounts", "banks"):
        op.drop_table(table)

    buckets = op.create_table(
        "budget_buckets",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=60), nullable=False),
        sa.Column("percent", sa.Numeric(5, 2), nullable=False),
        sa.Column("goal_type", sa.String(length=8), nullable=False, server_default="spend"),
        sa.Column("color", sa.String(length=9), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_budget_buckets"),
        sa.UniqueConstraint("name", name="uq_budget_buckets_name"),
    )

    op.create_table(
        "budget_months",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("month", sa.Integer(), nullable=False),
        sa.Column("income_basis", sa.Numeric(18, 2), nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_budget_months"),
        sa.UniqueConstraint("year", "month", name="uq_budget_months_year_month"),
    )

    op.create_table(
        "accounts",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("institution", sa.String(length=120), nullable=True),
        sa.Column("account_type", sa.String(length=32), nullable=False, server_default="savings"),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("balance", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("last_digits", sa.String(length=32), nullable=True),
        sa.Column("color", sa.String(length=9), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("bucket_id", sa.Integer(), nullable=True),
        sa.Column("include_in_total", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_accounts"),
        sa.ForeignKeyConstraint(
            ["bucket_id"], ["budget_buckets.id"],
            name="fk_accounts_bucket_id_budget_buckets", ondelete="SET NULL",
        ),
    )
    op.create_index("ix_accounts_bucket_id", "accounts", ["bucket_id"])

    categories = op.create_table(
        "categories",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=60), nullable=False),
        sa.Column("kind", sa.String(length=8), nullable=False),
        sa.Column("icon", sa.String(length=16), nullable=True),
        sa.Column("color", sa.String(length=9), nullable=True),
        sa.Column("keywords", sa.Text(), nullable=True),
        sa.Column("bucket_id", sa.Integer(), nullable=True),
        sa.Column("origin", sa.String(length=8), nullable=False, server_default="user"),
        sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_categories"),
        sa.UniqueConstraint("kind", "name", name="uq_categories_kind_name"),
        sa.ForeignKeyConstraint(
            ["bucket_id"], ["budget_buckets.id"],
            name="fk_categories_bucket_id_budget_buckets", ondelete="SET NULL",
        ),
    )
    op.create_index("ix_categories_bucket_id", "categories", ["bucket_id"])

    op.create_table(
        "merchant_rules",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("merchant_key", sa.String(length=120), nullable=False),
        sa.Column("category_id", sa.Integer(), nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_merchant_rules"),
        sa.UniqueConstraint("merchant_key", name="uq_merchant_rules_merchant_key"),
        sa.ForeignKeyConstraint(
            ["category_id"], ["categories.id"],
            name="fk_merchant_rules_category_id_categories", ondelete="CASCADE",
        ),
    )
    op.create_index("ix_merchant_rules_category_id", "merchant_rules", ["category_id"])

    op.create_table(
        "transactions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("kind", sa.String(length=10), nullable=False),
        sa.Column("amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("base_amount", sa.Numeric(18, 2), nullable=True),
        sa.Column("occurred_on", sa.Date(), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("account_id", sa.Integer(), nullable=True),
        sa.Column("account_delta", sa.Numeric(18, 2), nullable=True),
        sa.Column("to_account_id", sa.Integer(), nullable=True),
        sa.Column("to_account_delta", sa.Numeric(18, 2), nullable=True),
        sa.Column("category_id", sa.Integer(), nullable=True),
        sa.Column("merchant", sa.String(length=120), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("source", sa.String(length=8), nullable=False, server_default="manual"),
        sa.Column("categorized_by", sa.String(length=8), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_transactions"),
        sa.ForeignKeyConstraint(
            ["account_id"], ["accounts.id"],
            name="fk_transactions_account_id_accounts", ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["to_account_id"], ["accounts.id"],
            name="fk_transactions_to_account_id_accounts", ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["category_id"], ["categories.id"],
            name="fk_transactions_category_id_categories", ondelete="SET NULL",
        ),
    )
    for column in ("kind", "occurred_on", "account_id", "to_account_id", "category_id"):
        op.create_index(f"ix_transactions_{column}", "transactions", [column])

    op.create_table(
        "transaction_messages",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("sender", sa.String(length=120), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("body_hash", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=10), nullable=False, server_default="queued"),
        sa.Column("parsed_by", sa.String(length=8), nullable=True),
        sa.Column("error", sa.String(length=500), nullable=True),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("transaction_id", sa.Integer(), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_transaction_messages"),
        sa.ForeignKeyConstraint(
            ["transaction_id"], ["transactions.id"],
            name="fk_transaction_messages_transaction_id_transactions", ondelete="SET NULL",
        ),
    )
    for column in ("received_at", "body_hash", "status", "transaction_id"):
        op.create_index(f"ix_transaction_messages_{column}", "transaction_messages", [column])

    # ------------------------------------------------------------ seed data
    op.bulk_insert(
        buckets,
        [
            {"name": n, "percent": p, "goal_type": g, "color": c, "sort_order": i}
            for i, (n, p, g, c) in enumerate(DEFAULT_BUCKETS)
        ],
    )
    # Look each bucket up by name in SQL, so this also renders in --sql mode.
    bucket_ref = sa.table("budget_buckets", sa.column("id"), sa.column("name"))
    for i, (name, kind, icon, color, keywords, bucket) in enumerate(DEFAULT_CATEGORIES):
        bucket_id = (
            sa.select(bucket_ref.c.id).where(bucket_ref.c.name == bucket).scalar_subquery()
            if bucket
            else None
        )
        op.execute(
            categories.insert().values(
                name=name,
                kind=kind,
                icon=icon,
                color=color,
                keywords=keywords,
                bucket_id=bucket_id,
                origin="system",
                sort_order=i,
            )
        )


def downgrade() -> None:
    raise NotImplementedError(
        "0004 replaced the old finance schema and dropped its data; restore a backup instead."
    )
