"""The small LLM that reads bank SMS and picks categories.

Two jobs, both one-shot calls that return JSON matching a fixed schema:

    extract_sms()  raw SMS text -> transaction fields + a category choice
    categorize()   merchant/note -> an existing category, or a new name

Providers (LLM_PROVIDER):
    llamacpp  — llama.cpp's llama-server running on the Pi itself (the `llm`
                compose service; default Qwen2.5-1.5B-Instruct Q4_K_M). Free,
                private, offline. Talked to over its OpenAI-compatible API.
    anthropic — Claude Haiku 5.5 via the API. Most accurate; SMS text leaves the Pi.
    none      — off. Callers check enabled() first.

Speed on a Pi CPU (most of it is about not re-reading the prompt):
    - The prompt is ordered static-first: rules, then worked examples, then
      your accounts/categories, then the SMS. llama-server keeps the KV cache
      for the shared prefix (cache_prompt), so a warm call only processes the
      last few dozen tokens — nearly all the time is the short JSON answer.
    - A hard cap on output tokens; one slot (-np 1) so the cache isn't split.
    - "Thinking" is switched off for models that have it.
    - warm_up() at startup waits for the server and primes the cache.

Accuracy with a 1-2B model:
    - Output is grammar-constrained to a JSON schema, and three worked examples
      show the exact shape and judgement calls ("available credit" is not a
      balance, promos are not transactions).
    - Categories are offered and answered by name, which small models match
      far more reliably than ids.
    - Every number the model reports is checked against the SMS text; an
      amount that isn't literally in the message is rejected (the SMS waits in
      the inbox) rather than recorded wrong. The bank's own verb ("credited" /
      "debited") overrides the model's expense/income call when it's clear.
    - It only ever *suggests*: amounts are validated by Pydantic, categories
      are matched against the database, and new ones are only created when
      LLM_CREATE_CATEGORIES allows it.
"""

from __future__ import annotations

import json
import logging
import re
import time
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any

import anthropic
import httpx
from pydantic import ValidationError

from app.core.config import settings
from app.models import Account, Category
from app.schemas.finance import ParsedSms

logger = logging.getLogger("muney.llm")

DEFAULT_MODELS = {"anthropic": "claude-haiku-5-5", "llamacpp": "qwen2.5-1.5b"}

# Model families that reason before answering by default. For SMS extraction
# that only adds latency, so it's turned off for them via the chat template.
_THINKING_FAMILIES = ("qwen3", "deepseek-r1", "gpt-oss", "magistral", "smollm3")


class LlmError(RuntimeError):
    """The model was unreachable, refused, or returned something unusable."""


def enabled() -> bool:
    if settings.llm_provider == "anthropic":
        return bool(settings.anthropic_api_key)
    return settings.llm_provider == "llamacpp"


def model_name() -> str:
    return settings.llm_model or DEFAULT_MODELS.get(settings.llm_provider, "")


# ---------------------------------------------------------------- transport


def _nullable(schema: dict[str, Any]) -> dict[str, Any]:
    return {"anyOf": [schema, {"type": "null"}]}


Messages = list[dict[str, str]]


def _complete_json(system: str, messages: Messages, schema: dict[str, Any], max_out: int) -> dict:
    if settings.llm_provider == "llamacpp":
        return _llamacpp(system, messages, schema, max_out)
    if settings.llm_provider == "anthropic":
        return _anthropic(system, messages, schema)
    raise LlmError("LLM is disabled")


def _server_url(path: str) -> str:
    return f"{settings.llamacpp_url.rstrip('/')}{path}"


def _llamacpp(system: str, messages: Messages, schema: dict[str, Any], max_out: int) -> dict:
    body: dict[str, Any] = {
        # llama-server serves whatever model it was started with; this is a label.
        "model": model_name(),
        "messages": [{"role": "system", "content": system}, *messages],
        # Grammar-constrained decoding: the output can only be this JSON shape.
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": "result", "strict": True, "schema": schema},
        },
        "temperature": 0,
        "max_tokens": max_out,
        # Reuse the KV cache for the unchanged prompt prefix (rules + examples).
        "cache_prompt": True,
    }
    if model_name().lower().startswith(_THINKING_FAMILIES):
        body["chat_template_kwargs"] = {"enable_thinking": False}
    try:
        response = httpx.post(
            _server_url("/v1/chat/completions"),
            json=body,
            timeout=settings.llm_timeout_seconds,
        )
        response.raise_for_status()
        choice = response.json()["choices"][0]
        if choice.get("finish_reason") == "length":
            raise LlmError("the model's answer was cut off")
        return json.loads(choice["message"]["content"])
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text[:200]
        if exc.response.status_code == 503:
            detail = "still loading the model"
        raise LlmError(f"llama-server: {detail}") from exc
    except httpx.HTTPError as exc:
        raise LlmError(f"llama-server unreachable at {settings.llamacpp_url}: {exc}") from exc
    except (KeyError, IndexError, ValueError) as exc:
        raise LlmError("llama-server returned an unusable response") from exc


def _anthropic(system: str, messages: Messages, schema: dict[str, Any]) -> dict:
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key, timeout=45.0, max_retries=2)
    try:
        response = client.messages.create(
            model=model_name(),
            max_tokens=4096,
            system=system,
            messages=messages,
            # Extraction and classification don't need deep thought.
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": schema}},
        )
    except anthropic.AuthenticationError as exc:
        raise LlmError("Anthropic rejected the API key") from exc
    except anthropic.RateLimitError as exc:
        raise LlmError("Anthropic rate limit hit — will retry on the next re-run") from exc
    except anthropic.APIStatusError as exc:
        raise LlmError(f"Anthropic API error {exc.status_code}: {exc.message}") from exc
    except anthropic.APIConnectionError as exc:
        raise LlmError("Could not reach the Anthropic API") from exc

    if response.stop_reason == "refusal":
        raise LlmError("The model declined this message")
    if response.stop_reason == "max_tokens":
        raise LlmError("The model's answer was cut off")
    text = next((block.text for block in response.content if block.type == "text"), None)
    if text is None:
        raise LlmError("The model returned no text")
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise LlmError("The model returned invalid JSON") from exc


@dataclass
class CategoryChoice:
    category_id: int | None
    new_category: str | None


def _clean_name(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    value = " ".join(value.split()).strip()
    return value[:60] or None


# ------------------------------------------------------------------- prompts
#
# Small models follow short, concrete rules and examples far better than long
# prose. Everything up to the final user turn is identical on every call, which
# is what lets llama-server serve it from cache — keep it free of anything dynamic.

_SMS_SYSTEM = """\
You extract transactions from bank SMS alerts. Reply with JSON only.

is_transaction=false for: OTP or verification codes, promotions or offers, \
login or device alerts, declined or failed payments, payment reminders, due \
dates, statements, and balance-only messages.

kind:
- expense = money left the account (purchase, debit, ATM, bill, fee, sent to a person)
- income = money came in (credit, deposit, salary, refund, reversal, interest)

amount: the transaction amount, digits only, no commas. currency: 3-letter \
code; "Rs", "Rs." and "LKR" are LKR.
merchant: short shop, biller or person name in Title Case, or null. No \
reference numbers, no city, no terminal ids.
account: the account or card number exactly as shown, keeping any X or * \
mask (e.g. "09802XXXXX06", "0980***2106", "xx7710"), or null.
balance_after: the available balance of that account if stated. For credit \
cards "available credit" or "available limit" is NOT a balance -> null.
occurred_on: YYYY-MM-DD if the SMS has a date (dates are day-first), else null.
category: if one of the listed categories of the same kind is a natural home \
for this merchant, copy its name exactly. If none really fits (a vet is not \
Groceries, a gym is not Shopping), write a new short general name like "Pet \
care" or "Fitness" — never a shop name."""

# Worked examples, shown as earlier turns of the conversation.
_EXAMPLE_CATEGORIES = (
    "Expense categories: Groceries; Transport; Subscriptions; Shopping\n"
    "Income categories: Salary; Refunds"
)
_SMS_EXAMPLES: list[tuple[str, dict[str, Any]]] = [
    (
        f"{_EXAMPLE_CATEGORIES}\n\nSMS: Your A/C ****4821 debited LKR 3,640.50 at KEELLS SUPER "
        "NUGEGODA on 14/03/26. Avl Bal LKR 52,118.25",
        {
            "is_transaction": True, "kind": "expense", "amount": 3640.50, "currency": "LKR",
            "merchant": "Keells Super", "account": "****4821", "balance_after": 52118.25,
            "occurred_on": "2026-03-14", "category": "Groceries",
        },
    ),
    (
        f"{_EXAMPLE_CATEGORIES}\n\nSMS: USD 15.99 spent on card xx7710 at NETFLIX.COM. "
        "Available credit limit USD 1,984.01",
        {
            "is_transaction": True, "kind": "expense", "amount": 15.99, "currency": "USD",
            "merchant": "Netflix", "account": "xx7710", "balance_after": None,
            "occurred_on": None, "category": "Subscriptions",
        },
    ),
    (
        f"{_EXAMPLE_CATEGORIES}\n\nSMS: Enjoy 20% off at selected restaurants with your card! "
        "T&C apply. Reply STOP to opt out",
        {
            "is_transaction": False, "kind": "expense", "amount": 0, "currency": "LKR",
            "merchant": None, "account": None, "balance_after": None,
            "occurred_on": None, "category": None,
        },
    ),
]

_SMS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "is_transaction": {"type": "boolean"},
        # No "transfer": the model can't name the destination account, and an
        # SMS only ever shows one side. Mark own-account moves by hand.
        "kind": {"type": "string", "enum": ["expense", "income"]},
        "amount": {"type": "number"},
        "currency": {"type": "string"},
        "merchant": _nullable({"type": "string"}),
        "account": _nullable({"type": "string"}),
        "balance_after": _nullable({"type": "number"}),
        "occurred_on": _nullable({"type": "string"}),
        "category": _nullable({"type": "string"}),
    },
    "required": [
        "is_transaction", "kind", "amount", "currency", "merchant", "account",
        "balance_after", "occurred_on", "category",
    ],
    "additionalProperties": False,
}

_CATEGORIZE_SYSTEM = """\
You file personal finance transactions into categories. Reply with JSON only.
category: if one of the listed categories is a natural home for this \
merchant, copy its name exactly. If none really fits (a vet is not Groceries, \
a gym is not Shopping), write a new short general name like "Pet care" or \
"Fitness" — never a shop name."""

_CATEGORIZE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"category": _nullable({"type": "string"})},
    "required": ["category"],
    "additionalProperties": False,
}


def _example_turns() -> Messages:
    turns: Messages = []
    for user, answer in _SMS_EXAMPLES:
        turns.append({"role": "user", "content": user})
        # Compact on purpose: the model copies this layout, and on a Pi CPU every
        # newline and indent is a token generated at ~5-10 tokens/second.
        turns.append({"role": "assistant", "content": json.dumps(answer, separators=(",", ":"))})
    return turns


def _category_lines(
    categories: list[Category], kinds: tuple[str, ...] = ("expense", "income")
) -> str:
    # Names, not ids: a 1-2B model matches "Groceries" far more reliably than
    # "id 17". Sorted by id so the text — and the cached prefix — stays stable.
    ordered = sorted(categories, key=lambda c: c.id)
    lines = []
    for kind in kinds:
        names = "; ".join(c.name for c in ordered if c.kind == kind) or "(none yet)"
        lines.append(f"{kind.title()} categories: {names}")
    return "\n".join(lines)


def _norm(name: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9]+", " ", name.lower().replace("&", " and ")).split())


def _choice(name: Any, kind: str, categories: list[Category]) -> CategoryChoice:
    """Map the model's category name onto an existing category, or a new name."""
    clean = _clean_name(name)
    if not clean:
        return CategoryChoice(None, None)
    key = _norm(clean)
    for category in categories:
        if category.kind == kind and _norm(category.name) == key:
            return CategoryChoice(category.id, None)
    # A name from the other kind's list (e.g. "Refunds" on an expense) is a
    # confusion, not a reason to invent a category.
    if any(_norm(c.name) == key for c in categories):
        return CategoryChoice(None, None)
    return CategoryChoice(None, clean)


def _account_lines(accounts: list[Account]) -> str:
    if not accounts:
        return "(none)"
    return "\n".join(
        f"- {a.name} ({a.currency}" + (f", number …{a.last_digits}" if a.last_digits else "") + ")"
        for a in sorted(accounts, key=lambda a: a.id)
    )


# ----------------------------------------------------------------- grounding

_NUMBER = re.compile(r"\d[\d,]*(?:\.\d+)?")


# "Avl Lmt", "Available limit", "available credit" — a card's headroom, not a balance.
_LIMIT_WORDS = re.compile(r"(limit|lmt|credit)\W*(\w+\W*){0,2}$", re.I)


def _is_limit(body: str, value: Decimal) -> bool:
    """True if `value` appears in the SMS right after limit/credit wording."""
    for match in _NUMBER.finditer(body):
        try:
            if Decimal(match.group().replace(",", "")) != value:
                continue
        except InvalidOperation:
            continue
        before = body[max(0, match.start() - 30) : match.start()]
        if _LIMIT_WORDS.search(before) and "bal" not in before.lower():
            return True
    return False


# How banks write currencies that aren't ISO codes. Rupees are the base currency.
_CURRENCY_ALIASES = {"RS": None, "RS.": None, "RUPEES": None, "SLR": None, "US$": "USD", "$": "USD"}


def _currency(value: Any, base_currency: str) -> str:
    code = str(value or "").strip().upper()
    if code in _CURRENCY_ALIASES:
        return _CURRENCY_ALIASES[code] or base_currency
    return code[:3] or base_currency


def _numbers_in(text: str) -> set[Decimal]:
    found = set()
    for match in _NUMBER.findall(text):
        try:
            found.add(Decimal(match.replace(",", "")))
        except InvalidOperation:
            continue
    return found


_CREDIT_WORDS = re.compile(
    r"\b(credited|received|deposit(ed)?|refund(ed)?|revers(al|ed)|cr)\b", re.I
)
_DEBIT_WORDS = re.compile(
    r"\b(debited|spent|purchase|withdrawal|withdrawn|paid|payment|dr|pos)\b", re.I
)


def _kind_from_wording(body: str) -> str | None:
    """The bank's own verb, when it's unambiguous: "credited" vs "debited"."""
    credit, debit = bool(_CREDIT_WORDS.search(body)), bool(_DEBIT_WORDS.search(body))
    if credit and not debit:
        return "income"
    if debit and not credit:
        return "expense"
    return None


def _ground(parsed: ParsedSms, body: str) -> ParsedSms:
    """Reject or strip anything the model reported that isn't in the SMS.

    Small models occasionally swap the amount and the balance, or invent
    digits. A wrong amount is worse than none, so it fails loudly instead.
    """
    numbers = _numbers_in(body)
    if Decimal(parsed.amount) not in numbers:
        raise LlmError(f"read amount {parsed.amount} but that number isn't in the SMS")
    updates: dict[str, Any] = {}
    if parsed.balance_after is not None and Decimal(parsed.balance_after) not in numbers:
        updates["balance_after"] = None
    if parsed.balance_after is not None and (
        Decimal(parsed.balance_after) == Decimal(parsed.amount)
        or _is_limit(body, Decimal(parsed.balance_after))
    ):
        updates["balance_after"] = None
    wording = _kind_from_wording(body)
    if wording and parsed.kind != wording:
        # Small models sometimes flip a reversal or refund; the bank's verb wins.
        # The category was chosen for the wrong kind, so drop it too.
        updates.update(kind=wording, category_id=None, new_category=None)
    # The account string should be copied from the SMS, mask and all. If the
    # model reshaped it ("ending 4821" -> "****4821"), its digits must still
    # be there; keep just those, or drop it.
    if parsed.account_hint:
        squeezed = re.sub(r"\s", "", body).upper()
        if re.sub(r"\s", "", parsed.account_hint).upper() not in squeezed:
            digits = "".join(ch for ch in parsed.account_hint if ch.isdigit())
            body_digits = "".join(ch for ch in body if ch.isdigit())
            updates["account_hint"] = digits if len(digits) >= 2 and digits in body_digits else None
    return parsed.model_copy(update=updates) if updates else parsed


# --------------------------------------------------------------------- tasks


def extract_sms(
    body: str,
    sender: str | None,
    accounts: list[Account],
    categories: list[Category],
    base_currency: str,
) -> ParsedSms | None:
    """Read one SMS. Returns None when it isn't a transaction. Raises LlmError."""
    user = (
        f"Accounts:\n{_account_lines(accounts)}\n\n"
        f"{_category_lines(categories)}\n\n"
        f"No currency shown means {base_currency}.\n\n"
        f"SMS from {sender or 'unknown'}: {body}"
    )
    started = time.perf_counter()
    data = _complete_json(
        _SMS_SYSTEM, [*_example_turns(), {"role": "user", "content": user}], _SMS_SCHEMA, 200
    )
    logger.info("LLM read SMS in %.1fs (%s)", time.perf_counter() - started, model_name())
    if not data.get("is_transaction"):
        return None

    occurred_on: date | None = None
    if data.get("occurred_on"):
        try:
            occurred_on = date.fromisoformat(str(data["occurred_on"]))
        except ValueError:
            occurred_on = None

    def decimal_or_none(value: Any) -> Decimal | None:
        if value is None:
            return None
        try:
            return Decimal(str(value))
        except InvalidOperation:
            return None

    choice = _choice(data.get("category"), str(data.get("kind")), list(categories))
    try:
        parsed = ParsedSms(
            kind=data["kind"],
            amount=Decimal(str(data["amount"])),
            currency=_currency(data.get("currency"), base_currency),
            merchant=_clean_name(data.get("merchant")),
            occurred_on=occurred_on,
            account_hint=_clean_name(data.get("account")),
            balance_after=decimal_or_none(data.get("balance_after")),
            category_id=choice.category_id,
            new_category=choice.new_category,
        )
    except (ValidationError, InvalidOperation, KeyError) as exc:
        # Typically an unsupported currency code or a zero amount.
        raise LlmError(f"model output failed validation: {exc}") from exc
    return _ground(parsed, body)


def categorize(
    kind: str, merchant: str | None, text: str | None, categories: list[Category]
) -> CategoryChoice:
    """Pick a category for one transaction. Raises LlmError."""
    user = (
        f"{_category_lines(categories, (kind,))}\n\n"
        f"Merchant: {merchant or 'unknown'}\nDetails: {text or 'none'}"
    )
    data = _complete_json(
        _CATEGORIZE_SYSTEM, [{"role": "user", "content": user}], _CATEGORIZE_SCHEMA, 30
    )
    return _choice(data.get("category"), kind, list(categories))


# ------------------------------------------------------- on-board lifecycle


def _health() -> str:
    """"ok", "loading", or raises httpx.HTTPError if the server isn't up."""
    response = httpx.get(_server_url("/health"), timeout=5.0)
    if response.status_code == 503:
        return "loading"
    response.raise_for_status()
    return "ok"


def warm_up() -> None:
    """Wait for llama-server to finish loading, then prime its prompt cache.

    Runs once at startup in a background thread. The first boot downloads the
    GGUF (~1 GB), so this can wait several minutes; afterwards the first real
    SMS of the day is answered at warm speed.
    """
    if settings.llm_provider != "llamacpp":
        return
    deadline = time.monotonic() + 30 * 60
    while True:
        try:
            if _health() == "ok":
                break
            logger.info("llama-server is loading the model…")
        except httpx.HTTPError as exc:
            logger.info("Waiting for llama-server (%s)", exc.__class__.__name__)
        if time.monotonic() > deadline:
            logger.warning("llama-server never became ready at %s", settings.llamacpp_url)
            return
        time.sleep(10)

    try:
        started = time.perf_counter()
        extract_sms("Your A/C ****0000 debited LKR 100.00 at TEST.", None, [], [], "LKR")
        logger.info("LLM %s warm in %.1fs", model_name(), time.perf_counter() - started)
    except LlmError as exc:
        logger.warning("LLM warm-up call failed: %s", exc)


def status() -> dict[str, Any]:
    """For the Settings page: is the model loaded and answering?"""
    info: dict[str, Any] = {
        "provider": settings.llm_provider,
        "model": model_name() or None,
        "ready": False,
        "detail": None,
    }
    if settings.llm_provider == "anthropic":
        info["ready"] = bool(settings.anthropic_api_key)
        info["detail"] = None if info["ready"] else "ANTHROPIC_API_KEY is not set"
    elif settings.llm_provider == "llamacpp":
        try:
            state = _health()
            info["ready"] = state == "ok"
            info["detail"] = "loaded and ready" if info["ready"] else "loading the model…"
            if info["ready"]:
                models = httpx.get(_server_url("/v1/models"), timeout=5.0).json().get("data", [])
                if models:
                    info["model"] = models[0].get("id") or info["model"]
        except httpx.HTTPError:
            info["detail"] = f"llama-server unreachable at {settings.llamacpp_url}"
    return info
