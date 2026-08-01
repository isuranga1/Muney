from decimal import Decimal
from enum import Enum
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, PlainSerializer

from app.core.config import settings

# Decimal everywhere internally (money must not round through binary floats),
# but emitted as a JSON number so the frontend gets `1234.5` and not `"1234.50"`.
Money = Annotated[Decimal, PlainSerializer(float, return_type=float, when_used="json")]
Rate = Annotated[Decimal, PlainSerializer(float, return_type=float, when_used="json")]


def _normalize_currency(value: str) -> str:
    code = value.strip().upper()
    if code not in settings.currency_set:
        allowed = ", ".join(sorted(settings.currency_set))
        raise ValueError(f"unsupported currency {code!r}; allowed: {allowed}")
    return code


CurrencyCode = Annotated[str, AfterValidator(_normalize_currency)]


class AccountType(str, Enum):
    savings = "savings"
    current = "current"
    fixed_deposit = "fixed_deposit"
    credit_card = "credit_card"
    investment = "investment"
    wallet = "wallet"
    loan = "loan"
    other = "other"


class ExpenseStatus(str, Enum):
    pending = "pending"
    paid = "paid"
    cancelled = "cancelled"


class IncomeStatus(str, Enum):
    expected = "expected"
    received = "received"
    cancelled = "cancelled"


class Recurrence(str, Enum):
    none = "none"
    weekly = "weekly"
    monthly = "monthly"
    quarterly = "quarterly"
    yearly = "yearly"


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Message(BaseModel):
    detail: str
