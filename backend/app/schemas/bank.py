from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import AccountType, CurrencyCode, Money, ORMModel


class AccountCreate(BaseModel):
    bank_id: int
    name: str = Field(min_length=1, max_length=120)
    account_type: AccountType = AccountType.savings
    currency: CurrencyCode
    balance: Money = Field(default=0)
    account_number: str | None = Field(default=None, max_length=64)
    notes: str | None = None
    sort_order: int = 0
    is_active: bool = True
    is_liability: bool = False


class AccountUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    bank_id: int | None = None
    name: str | None = Field(default=None, min_length=1, max_length=120)
    account_type: AccountType | None = None
    currency: CurrencyCode | None = None
    balance: Money | None = None
    account_number: str | None = Field(default=None, max_length=64)
    notes: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None
    is_liability: bool | None = None


class AccountRead(ORMModel):
    id: int
    bank_id: int
    name: str
    account_type: str
    currency: str
    balance: Money
    account_number: str | None
    notes: str | None
    sort_order: int
    is_active: bool
    is_liability: bool

    # Filled in by the API layer using the current FX rate map.
    converted_balance: Money | None = None
    converted_currency: str | None = None
    rate_available: bool = True


class BankCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    short_name: str | None = Field(default=None, max_length=40)
    country: str | None = Field(default=None, max_length=60)
    color: str | None = Field(default=None, max_length=9)
    notes: str | None = None
    sort_order: int = 0
    is_archived: bool = False


class BankUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=120)
    short_name: str | None = Field(default=None, max_length=40)
    country: str | None = Field(default=None, max_length=60)
    color: str | None = Field(default=None, max_length=9)
    notes: str | None = None
    sort_order: int | None = None
    is_archived: bool | None = None


class BankRead(ORMModel):
    id: int
    name: str
    short_name: str | None
    country: str | None
    color: str | None
    notes: str | None
    sort_order: int
    is_archived: bool
    accounts: list[AccountRead] = []

    # Net of liabilities, expressed in the base currency.
    total_converted: Money = 0
    converted_currency: str | None = None
