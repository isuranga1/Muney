"""Forwarded bank SMS -> stored message -> transaction -> account balance.

    ingest()          store the raw SMS (deduped) as `queued` and return at
                      once — the iPhone Shortcut never waits on the LLM
    process_by_id()   background step: regex parsers, then the LLM, then record
    record()          the one place a ParsedSms becomes a transaction; the
                      inbox's "record by hand" goes through it too

A message nothing can read stays `pending` in the inbox; it is never dropped.
"""

from __future__ import annotations

import hashlib
import logging
import re
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import SessionLocal
from app.models import Account, Category, Transaction, TransactionMessage
from app.schemas.finance import ParsedSms, SmsIngest
from app.services import categorizer, ledger, llm
from app.services.fx import get_rate_map, quantize_money
from app.services.sms_parser import IGNORE, parse_message

logger = logging.getLogger("muney.ingest")


class IngestError(ValueError):
    """The message can't be recorded as given."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _local_date(moment: datetime) -> date:
    # The container runs with TZ=Asia/Colombo, so this is the date the phone showed.
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone().date()


# ----------------------------------------------------------------- ingest


def ingest(db: Session, payload: SmsIngest) -> tuple[TransactionMessage, bool]:
    """Store one forwarded SMS. Returns (message, was_duplicate)."""
    body = payload.message.strip()
    sender = (payload.sender or "").strip() or None
    received_at = payload.received_at or _now()
    if received_at.tzinfo is None:
        received_at = received_at.astimezone()

    digest = hashlib.sha256(f"{sender or ''}\n{body}".encode()).hexdigest()
    window = timedelta(minutes=settings.ingest_dedupe_minutes)
    existing = db.scalar(
        select(TransactionMessage)
        .where(
            TransactionMessage.body_hash == digest,
            TransactionMessage.received_at.between(received_at - window, received_at + window),
        )
        .limit(1)
    )
    if existing is not None:
        return existing, True

    message = TransactionMessage(
        body=body, sender=sender, received_at=received_at, body_hash=digest, status="queued"
    )
    db.add(message)
    db.commit()
    db.refresh(message)
    return message, False


def process_by_id(message_id: int) -> None:
    """Background task entry point — owns its own session."""
    with SessionLocal() as db:
        message = db.get(TransactionMessage, message_id)
        if message is None or message.status not in ("queued", "pending", "failed"):
            return
        process(db, message)
        db.commit()


def process_queued() -> int:
    """Pick up anything left `queued` by a restart. Returns how many were handled."""
    with SessionLocal() as db:
        ids = list(
            db.scalars(
                select(TransactionMessage.id).where(TransactionMessage.status == "queued")
            ).all()
        )
    for message_id in ids:
        process_by_id(message_id)
    return len(ids)


def process(db: Session, message: TransactionMessage) -> None:
    """Read one message and record it if possible. Never raises."""
    message.error = None
    try:
        result = parse_message(message.body, message.sender)
    except Exception as exc:  # noqa: BLE001 - a buggy parser must not lose the SMS
        message.status, message.error = "failed", f"parser crashed: {exc}"[:500]
        return
    parsed_by = "regex"

    if result is None and llm.enabled():
        try:
            accounts = list(
                db.scalars(select(Account).where(Account.is_archived.is_(False))).all()
            )
            result = llm.extract_sms(
                message.body,
                message.sender,
                accounts,
                categorizer.active_categories(db),
                settings.base_currency,
            ) or IGNORE
            parsed_by = "llm"
        except llm.LlmError as exc:
            message.status, message.error = "pending", f"LLM: {exc}"[:500]
            return

    if result is IGNORE:
        message.status, message.parsed_by = "ignored", parsed_by
        return
    if result is None:
        message.status = "pending"
        return

    try:
        # Savepoint: a half-recorded transaction rolls back without losing the SMS.
        with db.begin_nested():
            record(db, message, result, parsed_by)
    except (IngestError, ledger.LedgerError) as exc:
        message.status, message.error = "failed", str(exc)[:500]


# ----------------------------------------------------------------- record


def _shown_parts(shown: str) -> tuple[str, str]:
    """Split a masked account number into the digits before and after the mask.

    "09802XXXXX06" -> ("09802", "06");  "0980***2106" -> ("0980", "2106");
    "1234" -> ("", "1234").
    """
    parts = re.split(r"[X*•#]+", re.sub(r"[\s-]", "", shown.upper()))
    digits = ["".join(ch for ch in part if ch.isdigit()) for part in parts]
    if len(digits) == 1:
        return "", digits[0]
    return digits[0], digits[-1]


def account_match_score(stored: str | None, shown: str | None) -> int:
    """How well an account's number fits a number from an SMS; 0 = it doesn't.

    `stored` is whatever you typed on the Accounts page — the full number or
    just the last few digits. The SMS's trailing digits must agree with its
    end; its leading digits are checked too when you've stored enough of the
    number to compare. More agreeing digits = higher score.
    """
    number = "".join(ch for ch in (stored or "") if ch.isdigit())
    if not number or not shown:
        return 0
    prefix, suffix = _shown_parts(shown)
    if not suffix or not (number.endswith(suffix) or suffix.endswith(number)):
        return 0
    score = min(len(number), len(suffix))
    if prefix and len(number) >= len(prefix) + len(suffix):
        if not number.startswith(prefix):
            return 0
        score += len(prefix)
    return score


def _resolve_account(db: Session, parsed: ParsedSms) -> Account | None:
    if parsed.account_id is not None:
        account = db.get(Account, parsed.account_id)
        if account is None:
            raise IngestError(f"Unknown account id {parsed.account_id}")
        return account
    if not parsed.account_hint:
        return None

    scored = [
        (account_match_score(a.last_digits, parsed.account_hint), a)
        for a in db.scalars(select(Account).where(Account.is_archived.is_(False))).all()
    ]
    best = max((score for score, _ in scored), default=0)
    if best == 0:
        return None
    candidates = [a for score, a in scored if score == best]
    # Only "…06" visible and two accounts end in 06: the currency decides.
    if len(candidates) > 1:
        candidates = [a for a in candidates if a.currency == parsed.currency] or candidates
    return candidates[0] if len(candidates) == 1 else None


def _fees_category(db: Session) -> Category | None:
    return db.scalar(
        select(Category).where(
            Category.kind == "expense",
            Category.is_archived.is_(False),
            func.lower(Category.name).in_(("fees & charges", "fees", "bank charges", "bank fees")),
        )
    )


def record(
    db: Session, message: TransactionMessage, parsed: ParsedSms, parsed_by: str
) -> Transaction:
    if message.status == "processed":
        raise IngestError("This message has already been recorded")

    account = _resolve_account(db, parsed)
    kind = parsed.kind
    occurred_on = parsed.occurred_on or _local_date(message.received_at)

    # A category typed by hand, or set by a regex parser, is taken as-is. The
    # LLM's pick only counts after learned rules and keywords have had a go.
    if parsed.category_id is not None and parsed_by != "llm":
        category_id = parsed.category_id
        method = "user" if parsed_by == "manual" else "rule"
    else:
        hint = None
        if parsed_by == "llm":
            hint = llm.CategoryChoice(parsed.category_id, parsed.new_category)
        category, method = categorizer.categorize(
            db, kind, parsed.merchant, message.body, llm_hint=hint
        )
        category_id = category.id if category else None

    txn = ledger.create(
        db,
        kind=kind,
        amount=parsed.amount,
        currency=parsed.currency,
        occurred_on=occurred_on,
        occurred_at=parsed.occurred_at,
        account_id=account.id if account else None,
        to_account_id=parsed.to_account_id,
        category_id=category_id,
        merchant=parsed.merchant,
        note=parsed.note,
        source="sms",
        categorized_by=method,
        auto_categorize=False,
    )
    if method == "user":
        categorizer.learn(db, parsed.merchant, category_id)

    if parsed.fee:
        fees = _fees_category(db)
        ledger.create(
            db,
            kind="expense",
            amount=parsed.fee,
            currency=parsed.currency,
            occurred_on=occurred_on,
            occurred_at=parsed.occurred_at,
            account_id=account.id if account else None,
            category_id=fees.id if fees else None,
            merchant=parsed.merchant,
            note="Bank fee on this transaction",
            source="sms",
            categorized_by="rule" if fees else None,
            auto_categorize=False,
        )

    # The bank's own figure beats our running total — it self-corrects any SMS
    # that never arrived. Card "available credit" is not a balance, so skip those.
    if parsed.balance_after is not None and account is not None and not account.is_liability:
        account.balance = quantize_money(Decimal(parsed.balance_after))

    message.transaction_id = txn.id
    message.status = "processed"
    message.parsed_by = parsed_by
    message.processed_at = _now()
    message.error = None if account else "Recorded, but no account matched — no balance moved"
    if account is not None and kind in ("expense", "income"):
        db.flush()  # the pairing queries below must see this message's link
        txn = _pair_transfer(db, txn) or txn
    return txn


# ---------------------------------------------------------- transfer pairing
#
# Moving money between your own accounts sends two SMS: a debit on one and a
# credit on the other, often at the very same second (USD 50 out of the USD
# account, LKR 16,457.50 into the LKR one). Recorded separately they'd count
# as spending *and* income. When the halves line up, they become one transfer.

# Bank time stamps on the two halves agree to the second; allow a little slack.
_PAIR_EXACT = timedelta(minutes=2)
# Without printed times, both SMS must have reached the phone close together.
_PAIR_ARRIVAL = timedelta(minutes=10)
# The bank's conversion rate vs ours: generous with matching times, tight without.
_PAIR_FX_TOLERANCE_TIMED = Decimal("0.15")
_PAIR_FX_TOLERANCE_UNTIMED = Decimal("0.05")


def _arrival(db: Session, txn: Transaction) -> datetime | None:
    return db.scalar(
        select(TransactionMessage.received_at).where(TransactionMessage.transaction_id == txn.id)
    )


def _same_moment(db: Session, a: Transaction, b: Transaction) -> bool | None:
    """True/False on printed times; None if we can only go by arrival."""
    if a.occurred_at and b.occurred_at:
        return abs(_aware(a.occurred_at) - _aware(b.occurred_at)) <= _PAIR_EXACT
    first, second = _arrival(db, a), _arrival(db, b)
    if first and second and abs(_aware(first) - _aware(second)) <= _PAIR_ARRIVAL:
        return None
    return False


def _aware(moment: datetime) -> datetime:
    # Bank times are local wall-clock times; a store that drops the zone gives
    # them back naive, and they must not be mistaken for UTC.
    return moment if moment.tzinfo else moment.astimezone()


def _amounts_agree(out: Transaction, into: Transaction, rates, tolerance: Decimal) -> bool:
    if out.currency == into.currency:
        return Decimal(out.amount) == Decimal(into.amount)
    converted = ledger.between(Decimal(out.amount), out.currency, into.currency, rates)
    if converted is None or not into.amount:
        return False
    return abs(converted - Decimal(into.amount)) / Decimal(into.amount) <= tolerance


def _pair_transfer(db: Session, txn: Transaction) -> Transaction | None:
    other_kind = "income" if txn.kind == "expense" else "expense"
    candidates = db.scalars(
        select(Transaction).where(
            Transaction.id != txn.id,
            Transaction.source == "sms",
            Transaction.kind == other_kind,
            Transaction.account_id.is_not(None),
            Transaction.account_id != txn.account_id,
            Transaction.occurred_on.between(
                txn.occurred_on - timedelta(days=1), txn.occurred_on + timedelta(days=1)
            ),
        )
    ).all()
    rates = get_rate_map(db)
    for other in candidates:
        moment = _same_moment(db, txn, other)
        if moment is False:
            continue
        out, into = (txn, other) if txn.kind == "expense" else (other, txn)
        tolerance = _PAIR_FX_TOLERANCE_TIMED if moment else _PAIR_FX_TOLERANCE_UNTIMED
        if not _amounts_agree(out, into, rates, tolerance):
            continue
        return _merge(db, out, into)
    return None


def _merge(db: Session, out: Transaction, into: Transaction) -> Transaction:
    destination = db.get(Account, into.account_id)
    messages = db.scalars(
        select(TransactionMessage).where(TransactionMessage.transaction_id.in_((out.id, into.id)))
    ).all()
    fields = dict(
        kind="transfer",
        amount=Decimal(out.amount),
        currency=out.currency,
        occurred_on=out.occurred_on,
        occurred_at=out.occurred_at or into.occurred_at,
        account_id=out.account_id,
        to_account_id=into.account_id,
        # What actually landed, at the bank's rate rather than ours.
        to_amount=Decimal(into.amount)
        if destination is not None and into.currency == destination.currency
        else None,
        note="; ".join(n for n in (out.note, into.note) if n) or None,
        source="sms",
        auto_categorize=False,
    )
    # Deleting reverses both balance moves and creating re-applies the same
    # ones, so balances (including any snapped "Avl Bal") end up unchanged.
    ledger.delete(db, out)
    ledger.delete(db, into)
    transfer = ledger.create(db, **fields)
    for message in messages:
        message.transaction_id = transfer.id
    logger.info("Paired SMS debit and credit into transfer %s", transfer.id)
    return transfer


def reprocess(db: Session) -> tuple[int, int]:
    """Re-run pending and failed messages. Returns (checked, processed)."""
    rows = db.scalars(
        select(TransactionMessage)
        .where(TransactionMessage.status.in_(("queued", "pending", "failed")))
        .order_by(TransactionMessage.received_at)
    ).all()
    processed = 0
    for message in rows:
        process(db, message)
        processed += message.status == "processed"
    db.commit()
    return len(rows), processed
