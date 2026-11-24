from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import (
    AccountType,
    CategoryKind,
    CurrencyCode,
    GoalType,
    Money,
    ORMModel,
    TransactionKind,
)

# ------------------------------------------------------------------ accounts


class AccountCreate(BaseModel):
    model_config = ConfigDict(use_enum_values=True)

    name: str = Field(min_length=1, max_length=120)
    institution: str | None = Field(default=None, max_length=120)
    account_type: AccountType = AccountType.savings
    currency: CurrencyCode
    balance: Money = Field(default=0)
    last_digits: str | None = Field(default=None, max_length=32)
    color: str | None = Field(default=None, max_length=9)
    notes: str | None = None
    include_in_total: bool = True
    sort_order: int = 0


class AccountUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", use_enum_values=True)

    name: str | None = Field(default=None, min_length=1, max_length=120)
    institution: str | None = Field(default=None, max_length=120)
    account_type: AccountType | None = None
    # Currency is fixed once transactions exist against the account.
    currency: CurrencyCode | None = None
    # Setting it directly is a reconciliation: "the bank app says X".
    balance: Money | None = None
    last_digits: str | None = Field(default=None, max_length=32)
    color: str | None = Field(default=None, max_length=9)
    notes: str | None = None
    include_in_total: bool | None = None
    is_archived: bool | None = None
    sort_order: int | None = None


class AccountRead(ORMModel):
    id: int
    name: str
    institution: str | None
    account_type: str
    currency: str
    balance: Money
    last_digits: str | None
    color: str | None
    notes: str | None
    include_in_total: bool
    is_archived: bool
    sort_order: int
    is_liability: bool

    # Filled in from the current FX map. None when no rate is known.
    base_balance: Money | None = None
    secondary_balance: Money | None = None


class CurrencyTotal(BaseModel):
    currency: str
    # Signed — liabilities subtract.
    total: Money
    base_total: Money | None
    account_count: int


class AccountsOverview(BaseModel):
    base_currency: str
    secondary_currency: str | None
    net_worth: Money
    net_worth_secondary: Money | None
    assets: Money
    liabilities: Money
    by_currency: list[CurrencyTotal]
    accounts: list[AccountRead]
    unconvertible: list[str]


# ---------------------------------------------------------------- categories


class CategoryCreate(BaseModel):
    model_config = ConfigDict(use_enum_values=True)

    name: str = Field(min_length=1, max_length=60)
    kind: CategoryKind = CategoryKind.expense
    icon: str | None = Field(default=None, max_length=16)
    color: str | None = Field(default=None, max_length=9)
    keywords: str | None = None
    bucket_id: int | None = None
    sort_order: int = 0


class CategoryUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", use_enum_values=True)

    name: str | None = Field(default=None, min_length=1, max_length=60)
    icon: str | None = Field(default=None, max_length=16)
    color: str | None = Field(default=None, max_length=9)
    keywords: str | None = None
    bucket_id: int | None = None
    is_archived: bool | None = None
    sort_order: int | None = None
    # Accepting an LLM-made category flips this to "user".
    origin: str | None = Field(default=None, pattern="^(user|system|llm)$")


class CategoryRead(ORMModel):
    id: int
    name: str
    kind: str
    icon: str | None
    color: str | None
    keywords: str | None
    bucket_id: int | None
    origin: str
    is_archived: bool
    sort_order: int


# -------------------------------------------------------------- transactions


class TransactionCreate(BaseModel):
    model_config = ConfigDict(use_enum_values=True)

    kind: TransactionKind
    amount: Money = Field(gt=0)
    # Defaults to the account's currency.
    currency: CurrencyCode | None = None
    occurred_on: date | None = None
    account_id: int | None = None
    to_account_id: int | None = None
    # Transfers between currencies: what landed in the destination account.
    # Omit to convert at today's rate.
    to_amount: Money | None = Field(default=None, gt=0)
    category_id: int | None = None
    merchant: str | None = Field(default=None, max_length=120)
    note: str | None = None
    # Leave category empty and let rules / the LLM choose.
    auto_categorize: bool = True


class TransactionUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", use_enum_values=True)

    kind: TransactionKind | None = None
    amount: Money | None = Field(default=None, gt=0)
    currency: CurrencyCode | None = None
    occurred_on: date | None = None
    account_id: int | None = None
    to_account_id: int | None = None
    to_amount: Money | None = Field(default=None, gt=0)
    category_id: int | None = None
    merchant: str | None = Field(default=None, max_length=120)
    note: str | None = None


class TransactionRead(ORMModel):
    id: int
    kind: str
    amount: Money
    currency: str
    base_amount: Money | None
    occurred_on: date
    occurred_at: datetime | None
    account_id: int | None
    account_delta: Money | None
    to_account_id: int | None
    to_account_delta: Money | None
    category_id: int | None
    merchant: str | None
    note: str | None
    source: str
    categorized_by: str | None
    created_at: datetime


# -------------------------------------------------------------------- budget


class BucketCreate(BaseModel):
    model_config = ConfigDict(use_enum_values=True)

    name: str = Field(min_length=1, max_length=60)
    percent: Money = Field(ge=0, le=100)
    goal_type: GoalType = GoalType.spend
    color: str | None = Field(default=None, max_length=9)
    sort_order: int = 0


class BucketUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", use_enum_values=True)

    name: str | None = Field(default=None, min_length=1, max_length=60)
    percent: Money | None = Field(default=None, ge=0, le=100)
    goal_type: GoalType | None = None
    color: str | None = Field(default=None, max_length=9)
    sort_order: int | None = None


class BucketRead(ORMModel):
    id: int
    name: str
    percent: Money
    goal_type: str
    color: str | None
    sort_order: int


class BucketMonth(BaseModel):
    """One bucket's envelope for one month, all in base currency."""

    bucket_id: int
    name: str
    color: str | None
    goal_type: str
    # The month's percentage: frozen for finished months, the live rule otherwise.
    percent: Money
    # Left over (or overspent) at the end of last month.
    opening: Money
    # income x percent
    share: Money
    # Spending in the bucket's categories.
    spent: Money
    # Covered from, or given to, other buckets; plus money added or taken out.
    moved_in: Money
    moved_out: Money
    # opening + share + moved_in - spent - moved_out
    available: Money
    # spent / income, for "planned 50%, used 62%".
    used_percent: float | None
    # available < 0
    over: bool


class BudgetMonthStatus(BaseModel):
    year: int
    month: int
    base_currency: str
    secondary_currency: str | None
    # Base-currency units per 1 secondary, today.
    secondary_rate: float | None
    income_actual: Money
    income_basis: Money
    basis_is_override: bool
    total_percent: Money
    # A finished month that keeps the rule it had when the rule was changed.
    rule_frozen: bool
    buckets: list[BucketMonth]
    # Expenses whose category has no bucket — the gap in the rule.
    unassigned_spend: Money
    over_count: int


class BudgetBasisSet(BaseModel):
    # None clears the override and goes back to actual income.
    income_basis: Money | None = Field(default=None, ge=0)


class FundStatus(BaseModel):
    """A bucket's balance to date."""

    bucket_id: int
    name: str
    color: str | None
    goal_type: str
    percent: Money
    balance: Money
    # All months so far.
    total_share: Money
    total_spent: Money
    moved_in: Money
    moved_out: Money
    this_month_share: Money
    this_month_spent: Money


class FundsOverview(BaseModel):
    base_currency: str
    secondary_currency: str | None
    secondary_rate: float | None
    # First month counted.
    since_year: int
    since_month: int
    funds: list[FundStatus]
    total: Money
    # Spending in no bucket, all months so far — it's not in any balance.
    unassigned_spend: Money


class FundMoveCreate(BaseModel):
    """Both buckets: cover one from the other. Only `to`: add money. Only `from`: take out."""

    from_bucket_id: int | None = None
    to_bucket_id: int | None = None
    amount: Money = Field(gt=0)
    # Converted to base currency at today's rate.
    currency: CurrencyCode | None = None
    moved_on: date | None = None
    note: str | None = Field(default=None, max_length=200)


class FundMoveRead(ORMModel):
    id: int
    moved_on: date
    from_bucket_id: int | None
    to_bucket_id: int | None
    amount: Money
    note: str | None


# ------------------------------------------------------------------- reports


class CategoryTotal(BaseModel):
    category_id: int | None
    name: str
    icon: str | None
    color: str | None
    total: Money
    count: int
    share: float


class DayTotal(BaseModel):
    day: date
    income: Money
    expense: Money


class MonthReport(BaseModel):
    year: int
    month: int
    base_currency: str
    secondary_currency: str | None
    secondary_rate: float | None
    income: Money
    expense: Money
    net: Money
    savings_rate: float | None
    transaction_count: int
    expense_by_category: list[CategoryTotal]
    income_by_category: list[CategoryTotal]
    by_day: list[DayTotal]
    # Same figures for the month before, for "+12% vs last month".
    previous_income: Money
    previous_expense: Money


class MonthTotal(BaseModel):
    month: int
    income: Money
    expense: Money
    net: Money


class CategoryYearRow(BaseModel):
    category_id: int | None
    name: str
    icon: str | None
    color: str | None
    total: Money
    # Index 0 = January.
    months: list[Money]


class YearReport(BaseModel):
    year: int
    base_currency: str
    income: Money
    expense: Money
    net: Money
    months: list[MonthTotal]
    expense_categories: list[CategoryYearRow]
    income_categories: list[CategoryYearRow]


# ---------------------------------------------------------------- SMS inbox


class SmsIngest(BaseModel):
    """What the iPhone Shortcut POSTs. Only `message` is required."""

    message: str = Field(min_length=1, max_length=4000)
    sender: str | None = Field(default=None, max_length=120)
    # The Shortcut's "Current Date". Falls back to the server's clock.
    received_at: datetime | None = None


class ParsedSms(BaseModel):
    """What reading an SMS produces — from a regex parser, the LLM, or by hand."""

    model_config = ConfigDict(use_enum_values=True)

    kind: TransactionKind
    amount: Money = Field(gt=0)
    currency: CurrencyCode
    merchant: str | None = Field(default=None, max_length=120)
    occurred_on: date | None = None
    # Exact time printed in the SMS, when there is one. Used to pair the two
    # halves of a move between your own accounts into one transfer.
    occurred_at: datetime | None = None
    # Explicit account wins; otherwise the account number as the SMS shows it
    # ("09802XXXXX06", "0980***2106") is matched against Account.last_digits.
    account_id: int | None = None
    account_hint: str | None = Field(default=None, max_length=32)
    to_account_id: int | None = None
    # "Avl Bal" in the SMS. Snaps the account balance to the bank's figure.
    balance_after: Money | None = None
    category_id: int | None = None
    # LLM suggestion when nothing existing fits.
    new_category: str | None = Field(default=None, max_length=60)
    # A charge on top, in the same currency (ATM fee) — recorded as its own expense.
    fee: Money | None = Field(default=None, gt=0)
    note: str | None = Field(default=None, max_length=500)


class MessageRead(ORMModel):
    id: int
    body: str
    sender: str | None
    received_at: datetime
    status: str
    parsed_by: str | None
    error: str | None
    processed_at: datetime | None
    transaction_id: int | None


class IngestResult(BaseModel):
    id: int
    status: str
    duplicate: bool = False


class ReprocessResult(BaseModel):
    checked: int
    processed: int
