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
    credit_card = "credit_card"
    cash = "cash"
    wallet = "wallet"
    investment = "investment"
    fixed_deposit = "fixed_deposit"
    loan = "loan"


class TransactionKind(str, Enum):
    expense = "expense"
    income = "income"
    transfer = "transfer"


class CategoryKind(str, Enum):
    expense = "expense"
    income = "income"


class GoalType(str, Enum):
    save = "save"
    spend = "spend"


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Message(BaseModel):
    detail: str
