"""Choose a category for a transaction, cheapest method first.

    1. rule     — a merchant you've categorised by hand before (MerchantRule)
    2. keyword  — a category's keyword list matches the merchant or text;
                  the longest matching keyword wins
    3. llm      — ask the model; it may propose a new category, which is
                  created (origin="llm") when LLM_CREATE_CATEGORIES is on

Recategorising a transaction by hand calls learn(), so the same merchant never
needs the model again.
"""

from __future__ import annotations

import logging
import re

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import Category, MerchantRule
from app.services import llm

logger = logging.getLogger("muney.categorizer")

# Colours for categories the LLM creates, cycled by id.
_NEW_COLORS = ["#2a78d6", "#e0812b", "#7a5cd6", "#2a9d8f", "#d64f8a", "#c9a227", "#1abc9c"]


def merchant_key(merchant: str | None) -> str | None:
    """Normalise "KEELLS SUPER - KOLLUPITIYA 0042" and "Keells Super" to one key."""
    if not merchant:
        return None
    key = re.sub(r"[^a-z ]+", " ", merchant.lower())
    key = " ".join(key.split())
    return key[:120] or None


def active_categories(db: Session, kind: str | None = None) -> list[Category]:
    stmt = select(Category).where(Category.is_archived.is_(False))
    if kind:
        stmt = stmt.where(Category.kind == kind)
    return list(db.scalars(stmt.order_by(Category.sort_order, Category.name)).all())


def _by_rule(db: Session, kind: str, merchant: str | None) -> Category | None:
    key = merchant_key(merchant)
    if not key:
        return None
    rule = db.scalar(select(MerchantRule).where(MerchantRule.merchant_key == key))
    if rule is None:
        return None
    category = db.get(Category, rule.category_id)
    if category is None or category.kind != kind or category.is_archived:
        return None
    return category


def _by_keyword(categories: list[Category], *texts: str | None) -> Category | None:
    haystack = " ".join(t for t in texts if t).lower()
    if not haystack:
        return None
    best: Category | None = None
    best_len = 0
    for category in categories:
        for keyword in category.keyword_list:
            if len(keyword) > best_len and keyword in haystack:
                best, best_len = category, len(keyword)
    return best


def resolve_choice(
    db: Session, kind: str, category_id: int | None, new_name: str | None
) -> Category | None:
    """Turn a model's answer into a real Category — or None if it's unusable."""
    if category_id is not None:
        category = db.get(Category, category_id)
        if category is not None and category.kind == kind and not category.is_archived:
            return category
    if not new_name:
        return None

    existing = db.scalar(
        select(Category).where(Category.kind == kind, func.lower(Category.name) == new_name.lower())
    )
    if existing is not None:
        if existing.is_archived:
            return None
        return existing
    if not settings.llm_create_categories:
        return None

    count = db.scalar(select(func.count()).select_from(Category)) or 0
    category = Category(
        name=new_name,
        kind=kind,
        origin="llm",
        color=_NEW_COLORS[count % len(_NEW_COLORS)],
        sort_order=1000,
    )
    db.add(category)
    db.flush()
    logger.info("LLM created category %r (%s)", new_name, kind)
    return category


def categorize(
    db: Session,
    kind: str,
    merchant: str | None,
    text: str | None = None,
    *,
    llm_hint: llm.CategoryChoice | None = None,
    use_llm: bool = True,
) -> tuple[Category | None, str | None]:
    """Returns (category, method). `llm_hint` reuses a choice the model already made."""
    if kind not in ("expense", "income"):
        return None, None

    category = _by_rule(db, kind, merchant)
    if category:
        return category, "rule"

    categories = active_categories(db, kind)
    category = _by_keyword(categories, merchant, text)
    if category:
        return category, "keyword"

    if llm_hint is not None:
        category = resolve_choice(db, kind, llm_hint.category_id, llm_hint.new_category)
        return (category, "llm") if category else (None, None)

    if use_llm and llm.enabled() and (merchant or text):
        try:
            choice = llm.categorize(kind, merchant, text, categories)
        except llm.LlmError as exc:
            logger.warning("LLM categorisation skipped: %s", exc)
            return None, None
        category = resolve_choice(db, kind, choice.category_id, choice.new_category)
        if category:
            return category, "llm"
    return None, None


def learn(db: Session, merchant: str | None, category_id: int | None) -> None:
    """Remember a hand-picked category for this merchant."""
    key = merchant_key(merchant)
    if not key or category_id is None:
        return
    rule = db.scalar(select(MerchantRule).where(MerchantRule.merchant_key == key))
    if rule is None:
        db.add(MerchantRule(merchant_key=key, category_id=category_id))
    else:
        rule.category_id = category_id
