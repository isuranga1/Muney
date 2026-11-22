"""Deterministic SMS parsers — the fast, exact first pass before the LLM.

Every forwarded SMS is tried against PARSERS in order; the first non-None
answer wins. Anything no parser claims goes to the on-board LLM (or waits in
the inbox). A parser is instant and never misreads a number, so every format
your banks send regularly deserves one; the LLM is for the long tail.

Contract for each parser:
    parse(body, sender) -> ParsedSms | IGNORE | None

    ParsedSms  this is a transaction; record it
    IGNORE     definitely not a transaction (OTP, declined, reminder); stop here
    None       not mine — let the next parser (or the LLM) try

The HNB formats below were written from real messages (November 2026). If a
bank changes its wording the parser simply stops matching and the LLM takes
over, so nothing is lost — but add the new format here when you notice.

After adding one, deploy and press "Re-run" in the inbox.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from decimal import Decimal
from typing import Callable, Final

from app.schemas.finance import ParsedSms


class _Ignore:
    def __repr__(self) -> str:
        return "IGNORE"


IGNORE: Final = _Ignore()

ParseResult = ParsedSms | _Ignore | None
Parser = Callable[[str, str | None], ParseResult]

_AMOUNT = r"-?[\d,]+\.\d{2}"


# -------------------------------------------------------------------- noise

# Specific on purpose. Real HNB alerts all end with "DO NOT SHARE ACCOUNT
# DETAILS /OTP Hotline …", so a bare "OTP" or "do not share" would throw every
# genuine transaction away. Only an actual code ("… OTP … is 482913") counts.
_NOISE = re.compile(
    r"\bOTP\b[^\n]{0,80}?\b(?:is|:)\s*\d{4,8}\b"
    r"|\b\d{4,8}\s+is\s+(?:your|the)\s+(?:OTP|one[- ]time)"
    r"|one[- ]time (?:pass(?:word|code)|PIN)\s*(?:is|:)"
    r"|verification code\s*(?:is|:)"
    # Money that didn't move: refused payments and bill reminders.
    r"|\bdeclined\b|\bunsuccessful\b|insufficient (?:funds|limit)|please pay|pay before"
    r"|\bdue (?:date|on)\b",
    re.I,
)


def ignore_noise(body: str, sender: str | None) -> ParseResult:
    return IGNORE if _NOISE.search(body) else None


# ------------------------------------------------------------------ helpers


def _money(text: str) -> Decimal:
    return Decimal(text.replace(",", ""))


def _when(d: str, m: str, y: str, clock: str | None = None) -> tuple[date, datetime | None]:
    """Day-first date (+ optional HH:MM[:SS]) as the bank printed it, in local time."""
    year = int(y) + 2000 if len(y) == 2 else int(y)
    day = date(year, int(m), int(d))
    if not clock:
        return day, None
    parts = [int(p) for p in clock.split(":")]
    hour, minute, second = (parts + [0, 0])[:3]
    # The Pi runs with TZ=Asia/Colombo, which is the zone banks print in.
    return day, datetime(year, int(m), int(d), hour, minute, second).astimezone()


def _title(text: str) -> str:
    return " ".join(w if w.isupper() and len(w) <= 3 and "." not in w else w.capitalize() for w in text.split())


# Words that say how money moved, not who it went to.
_CHANNEL_WORDS = {"mb", "ib", "billpmt", "bill", "pmt", "ceft", "slips", "pos", "ft", "trf", "payment"}
# Reference codes: letters and digits mixed, 6+ characters ("SG2OT26102602AQ6-1").
_REFERENCE = re.compile(r"^(?=.*\d)(?=.*[a-z])[a-z0-9-]{6,}$", re.I)


def merchant_from_reason(reason: str | None) -> str | None:
    """Best guess at the counterparty in a free-text "Reason:" field.

    "MB BillPmt/Hutch 072/0720687117" -> "Hutch"
    "SG2OT26102602AQ6-1/PEKOE PTE. LTD." -> "Pekoe Pte. Ltd"
    "MB:me" -> None (your own note, kept on the transaction instead)
    """
    if not reason:
        return None
    for segment in re.split(r"[/:]", reason):
        words = [
            w
            for w in segment.split()
            if not w.isdigit()
            and w.lower().strip(".") not in _CHANNEL_WORDS
            and not _REFERENCE.match(w)
        ]
        name = " ".join(words).strip(" .-")
        if sum(ch.isalpha() for ch in name) >= 3:
            return _title(name)[:120]
    return None


def _place(location: str) -> str | None:
    """"COOL PLANET - SALES OUTLE" -> "Cool Planet"."""
    name = location.split(" - ")[0].strip(" ,.-")
    return _title(" ".join(name.split()))[:120] if name else None


# --------------------------------------------------------------------- HNB

_ALERT = re.compile(
    rf"(?P<cur>[A-Z]{{3}})\s*(?P<amt>{_AMOUNT})\s+(?P<dir>debited|credited)\s+(?:to|from)\s+"
    r"A/?c(?:count)?\s*No\s*[:.]?\s*(?P<acct>[\dX*]+)"
    r"\s+on\s+(?P<d>\d{1,2})/(?P<m>\d{1,2})/(?P<y>\d{2,4})(?:\s+(?P<t>\d{1,2}:\d{2}(?::\d{2})?))?"
    r"(?:\s+Reason\s*:\s*(?P<reason>.*?))?"
    rf"\s+Bal\s*:\s*(?P<bcur>[A-Z]{{3}})\s*(?P<bal>{_AMOUNT})",
    re.I | re.S,
)


def parse_debit_credit_alert(body: str, sender: str | None) -> ParseResult:
    """LKR 50.00 debited to Ac No:09802XXXXX06 on 22/11/26 10:29:06 Reason:MB BillPmt/Hutch … Bal:LKR 81.65"""
    m = _ALERT.search(body)
    if not m:
        return None
    day, at = _when(m["d"], m["m"], m["y"], m["t"])
    currency = m["cur"].upper()
    reason = " ".join((m["reason"] or "").split()) or None
    return ParsedSms(
        kind="expense" if m["dir"].lower() == "debited" else "income",
        amount=_money(m["amt"]),
        currency=currency,
        merchant=merchant_from_reason(reason),
        occurred_on=day,
        occurred_at=at,
        account_hint=m["acct"],
        balance_after=_money(m["bal"]) if m["bcur"].upper() == currency else None,
        note=f"Reason: {reason}" if reason else None,
    )


def _field(pattern: str, body: str) -> re.Match[str] | None:
    return re.search(pattern, body, re.I)


def parse_atm_receipt(body: str, sender: str | None) -> ParseResult:
    """HNB ATM Withdrawal e-Receipt / Amt(Approx.): 10000.00 LKR / A/C: 0980***2106 / Txn Fee: 30.00LKR …"""
    if not re.search(r"\bATM\s+Withdrawal\b", body, re.I):
        return None
    amount = _field(rf"Amt\S*\s*:?\s*(?P<amt>{_AMOUNT})\s*(?P<cur>[A-Z]{{3}})", body)
    account = _field(r"A/?C\s*:\s*(?P<acct>[\dX*]+)", body)
    if not amount or not account:
        return None
    currency = amount["cur"].upper()
    fee = _field(rf"(?:Txn\s+)?Fee\s*:\s*(?P<fee>{_AMOUNT})\s*(?P<cur>[A-Z]{{3}})", body)
    balance = _field(rf"Avl\.?\s*Bal\S*\s*:?\s*(?P<bal>{_AMOUNT})\s*(?P<cur>[A-Z]{{3}})", body)
    stamp = _field(
        r"Date\s*:\s*(?P<d>\d{1,2})[./](?P<m>\d{1,2})[./](?P<y>\d{2,4})(?:\s+Time\s*:\s*(?P<t>\d{1,2}:\d{2}))?",
        body,
    )
    location = _field(r"Location\s*:\s*(?P<loc>[^\n,]+)", body)
    day, at = _when(stamp["d"], stamp["m"], stamp["y"], stamp["t"]) if stamp else (None, None)
    place = _place(location["loc"]) if location else None
    return ParsedSms(
        kind="expense",
        amount=_money(amount["amt"]),
        currency=currency,
        merchant=f"ATM · {place}" if place else "ATM",
        occurred_on=day,
        occurred_at=at,
        account_hint=account["acct"],
        balance_after=_money(balance["bal"]) if balance and balance["cur"].upper() == currency else None,
        fee=_money(fee["fee"]) if fee and fee["cur"].upper() == currency and _money(fee["fee"]) > 0 else None,
        note="ATM withdrawal",
    )


_PURCHASE = re.compile(
    r"\bPURCHASE\s*,\s*(?:Debit|Credit)\s*account\s*:\s*(?P<acct>[\dX*]+)\s*,"
    r"\s*Location\s*:\s*(?P<loc>.+?)\s*,\s*[A-Z]{2}\s*,"
    rf"\s*Amount\S*\s*:\s*(?P<amt>{_AMOUNT})\s*(?P<cur>[A-Z]{{3}})\s*,"
    rf"\s*Av\.?\s*Bal\s*:\s*(?P<bal>{_AMOUNT})\s*(?P<bcur>[A-Z]{{3}})"
    r"(?:\s*,\s*Date\s*:\s*(?P<d>\d{1,2})\.(?P<m>\d{1,2})\.(?P<y>\d{2,4}))?"
    r"(?:\s*,\s*Time\s*:\s*(?P<t>\d{1,2}:\d{2}))?",
    re.I | re.S,
)


def parse_purchase_alert(body: str, sender: str | None) -> ParseResult:
    """HNB SMS ALERT: PURCHASE, Debit account:0980***2106,Location:COOL PLANET - SALES OUTLE, LK,Amount(Approx.):14750.00 LKR,Av.Bal:…"""
    m = _PURCHASE.search(body)
    if not m:
        return None
    day, at = _when(m["d"], m["m"], m["y"], m["t"]) if m["d"] else (None, None)
    currency = m["cur"].upper()
    return ParsedSms(
        kind="expense",
        amount=_money(m["amt"]),
        currency=currency,
        merchant=_place(m["loc"]),
        occurred_on=day,
        occurred_at=at,
        account_hint=m["acct"],
        balance_after=_money(m["bal"]) if m["bcur"].upper() == currency else None,
    )


# Most specific first. ignore_noise must stay first.
PARSERS: list[Parser] = [
    ignore_noise,
    parse_atm_receipt,
    parse_purchase_alert,
    parse_debit_credit_alert,
]


def parse_message(body: str, sender: str | None) -> ParseResult:
    for parser in PARSERS:
        result = parser(body, sender)
        if result is not None:
            return result
    return None
