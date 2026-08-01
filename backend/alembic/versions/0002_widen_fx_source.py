"""widen fx_rates.source

The column held the full provider URL, and 60 characters was not enough for a
CDN path — every refresh failed with StringDataRightTruncation. The service now
stores just the provider hostname, but the column is widened so a longer label
can never break writes again.

Revision ID: 0002
Revises: 0001
Create Date: 2026-08-01

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "fx_rates",
        "source",
        existing_type=sa.String(length=60),
        type_=sa.String(length=255),
        existing_nullable=False,
    )


def downgrade() -> None:
    # Truncate anything too long first, or the narrowing will fail.
    op.execute("UPDATE fx_rates SET source = left(source, 60)")
    op.alter_column(
        "fx_rates",
        "source",
        existing_type=sa.String(length=255),
        type_=sa.String(length=60),
        existing_nullable=False,
    )
