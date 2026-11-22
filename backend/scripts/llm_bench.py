"""Benchmark the running llama-server on bank SMS: speed and per-field accuracy.

Run it on the Pi, where the numbers actually matter:

    docker compose exec backend python scripts/llm_bench.py

It benchmarks whichever model the `llm` service is serving. To compare
models, change LLM_HF_MODEL (and LLM_MODEL, its label) in .env, run
`docker compose up -d llm`, wait for it to load, and run this again.

Every sample in scripts/sms_samples.json goes through the same path the app
uses: the regex parsers, then the model with its grounding checks, then
keyword rules for the category. Add your own real SMS to that file for numbers
that reflect your banks.

    --llm-only   skip the regex parsers: how well would the model cope on its
                 own if a bank changed its wording and a parser stopped matching?
"""

from __future__ import annotations

import json
import statistics
import sys
import time
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import settings  # noqa: E402
from app.services import llm  # noqa: E402
from app.services.ingest import account_match_score  # noqa: E402
from app.services.sms_parser import IGNORE, ignore_noise, parse_message  # noqa: E402

FIELDS = ["is_transaction", "kind", "amount", "currency", "account", "balance_after", "merchant", "category"]


def keyword_category(categories, kind: str, *texts: str | None):
    """The app's keyword step: longest matching keyword wins, before the model's pick."""
    haystack = " ".join(t for t in texts if t).lower()
    best, best_len = None, 0
    for c in categories:
        if c.kind != kind:
            continue
        for keyword in (k.strip().lower() for k in (c.keywords or "").split(",") if k.strip()):
            if len(keyword) > best_len and keyword in haystack:
                best, best_len = c.id, len(keyword)
    return best


def load_samples() -> dict:
    return json.loads((Path(__file__).with_name("sms_samples.json")).read_text(encoding="utf-8"))


ACCOUNT_NUMBERS: list[str] = []


def score(expect: dict, parsed, error: str | None) -> dict[str, bool]:
    """Which expected fields the model got right. Missing keys aren't scored."""
    got: dict[str, bool] = {}
    if error:
        # A grounding rejection on a real transaction is a miss on everything
        # (the SMS would wait for review), but on a non-transaction it's fine.
        is_tx = expect.get("is_transaction")
        got["is_transaction"] = is_tx is False
        if is_tx:
            for field in FIELDS[1:]:
                if field == "category" and "category_id" in expect or field in expect:
                    got[field] = False
        return got

    got["is_transaction"] = (parsed is not None) == expect["is_transaction"]
    if parsed is None or not expect["is_transaction"]:
        return got
    if "kind" in expect:
        got["kind"] = parsed.kind == expect["kind"]
    if "amount" in expect:
        got["amount"] = float(parsed.amount) == float(expect["amount"])
    if "currency" in expect:
        got["currency"] = parsed.currency == expect["currency"]
    if "account" in expect:
        # Would the app pick the right account from what was read?
        scores = {a: account_match_score(a, parsed.account_hint) for a in ACCOUNT_NUMBERS}
        best = max(scores.values(), default=0)
        winners = [a for a, score in scores.items() if score == best and score > 0]
        got["account"] = winners == [expect["account"]]
    if "balance_after" in expect:
        want, have = expect["balance_after"], parsed.balance_after
        got["balance_after"] = (want is None and have is None) or (
            want is not None and have is not None and float(have) == float(want)
        )
    if "merchant" in expect:
        got["merchant"] = expect["merchant"] in (parsed.merchant or "").lower()
    if "category_id" in expect:
        got["category"] = parsed.category_id == expect["category_id"]
    return got


def run(data: dict, llm_only: bool = False) -> dict:
    settings.llm_provider = "llamacpp"
    ACCOUNT_NUMBERS[:] = [a["last_digits"] for a in data["accounts"]]
    accounts = [SimpleNamespace(**a) for a in data["accounts"]]
    categories = [SimpleNamespace(**c) for c in data["categories"]]

    started = time.perf_counter()
    try:
        llm.extract_sms(data["samples"][0]["body"], None, accounts, categories, "LKR")
    except llm.LlmError:
        pass
    first = time.perf_counter() - started

    times: list[float] = []
    totals: dict[str, list[int]] = {f: [0, 0] for f in FIELDS}
    perfect = 0
    for sample in data["samples"]:
        started = time.perf_counter()
        parsed, error = None, None
        # Same order as the app: regex parsers first, the model only for the rest.
        # --llm-only still drops OTPs etc. first, exactly like the app does.
        regex = (ignore_noise if llm_only else parse_message)(sample["body"], sample.get("sender"))
        if regex is IGNORE:
            parsed = None
        elif regex is not None:
            parsed = regex
        else:
            try:
                parsed = llm.extract_sms(
                    sample["body"], sample.get("sender"), accounts, categories, "LKR"
                )
            except llm.LlmError as exc:
                error = str(exc)
            times.append(time.perf_counter() - started)
        if parsed is not None:
            # Keyword rules run before the model's category pick in the app.
            by_keyword = keyword_category(categories, parsed.kind, parsed.merchant, sample["body"])
            if by_keyword is not None:
                parsed = parsed.model_copy(update={"category_id": by_keyword})
        result = score(sample["expect"], parsed, error)
        for field, ok in result.items():
            totals[field][0] += ok
            totals[field][1] += 1
        if all(result.values()):
            perfect += 1
        else:
            wrong = ", ".join(f for f, ok in result.items() if not ok)
            print(f"   miss [{wrong}] {sample['body'][:70]}…" + (f"  ({error})" if error else ""))

    return {
        "first": first,
        "avg": statistics.mean(times) if times else 0.0,
        "p90": sorted(times)[max(0, int(len(times) * 0.9) - 1)] if times else 0.0,
        "perfect": perfect,
        "n": len(data["samples"]),
        "fields": {f: (v[0] / v[1] if v[1] else None) for f, v in totals.items()},
    }


def main() -> None:
    settings.llm_provider = "llamacpp"
    info = llm.status()
    if not info["ready"]:
        print(f"llama-server not ready: {info['detail']}")
        return
    data = load_samples()
    print(f"{info['model']} at {settings.llamacpp_url}, {len(data['samples'])} samples\n")
    llm_only = "--llm-only" in sys.argv
    if llm_only:
        print("Regex parsers off: every transaction goes to the model.\n")
    r = run(data, llm_only)
    print(
        f"\nfirst call {r['first']:.1f}s · model calls avg {r['avg']:.1f}s, p90 {r['p90']:.1f}s · "
        f"fully right {r['perfect']}/{r['n']}"
    )
    for field, value in r["fields"].items():
        print(f"  {field:<15}{'—' if value is None else f'{value * 100:.0f}%'}")


if __name__ == "__main__":
    main()
