"""RSS/Atom fetching and parsing.

Deliberately dependency-free: `xml.etree` plus `email.utils` cover every feed
this app was built against (EconomyNext, Ada Derana, Lanka Business Online,
Google News queries), so there is no feedparser to install or keep current on
the Pi.

Feeds are messy in practice, so the rule throughout is: skip what cannot be
understood, record why, and never let one bad feed break a refresh of the rest.
"""

from __future__ import annotations

import hashlib
import html
import re
import time
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from xml.etree import ElementTree as ET

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import Article, Feed

# Some publishers 403 an unadorned client.
HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; Muney/0.1; personal feed reader)",
    "Accept": "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8",
}
FETCH_TIMEOUT = 12.0
SUMMARY_LIMIT = 600
DEFAULT_RETENTION_DAYS = 60

# Observed in the wild: EconomyNext intermittently serves a 500 HTML error page
# and then answers fine on the next request. Without a retry a healthy feed gets
# flagged as broken at random, which is worse than a slightly slower refresh.
MAX_ATTEMPTS = 3
RETRY_STATUSES = {429, 500, 502, 503, 504}

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


class FeedError(RuntimeError):
    """A feed could not be fetched or parsed."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _strip_ns(tag: str) -> str:
    """`{http://www.w3.org/2005/Atom}entry` -> `entry`."""
    return tag.rpartition("}")[2] if "}" in tag else tag


def _clean_text(value: str | None, limit: int | None = None) -> str | None:
    """Feed descriptions are usually HTML fragments; we want a plain snippet."""
    if not value:
        return None
    text = _WS_RE.sub(" ", html.unescape(_TAG_RE.sub(" ", value))).strip()
    if not text:
        return None
    if limit and len(text) > limit:
        text = text[: limit - 1].rstrip() + "…"
    return text


def _parse_date(value: str | None) -> datetime | None:
    """Accept RFC-822 (RSS `pubDate`) and ISO-8601 (Atom `published`)."""
    if not value:
        return None
    raw = value.strip()
    try:
        parsed = parsedate_to_datetime(raw)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError, IndexError):
        pass
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _element_link(item: ET.Element) -> str | None:
    """RSS puts the URL in the element's text; Atom puts it in @href."""
    fallback = None
    for child in item:
        if _strip_ns(child.tag) != "link":
            continue
        href = child.get("href")
        rel = child.get("rel")
        if href and rel in (None, "alternate"):
            return href.strip()
        if href and fallback is None:
            fallback = href.strip()
        if child.text and child.text.strip():
            return child.text.strip()
    return fallback


def parse_feed(content: bytes) -> list[dict]:
    """Turn raw feed bytes into plain dicts. Raises FeedError on unusable XML."""
    try:
        root = ET.fromstring(content)
    except ET.ParseError as exc:
        raise FeedError(f"not valid XML ({exc})") from exc

    items = [el for el in root.iter() if _strip_ns(el.tag) in ("item", "entry")]
    if not items:
        raise FeedError("no <item> or <entry> elements found")

    parsed: list[dict] = []
    for item in items:
        fields: dict[str, str] = {}
        for child in item:
            tag = _strip_ns(child.tag)
            if tag == "link":
                continue
            if child.text and child.text.strip() and tag not in fields:
                fields[tag] = child.text.strip()

        title = _clean_text(fields.get("title"), 500)
        link = _element_link(item)
        if not title or not link:
            continue  # an entry with neither a title nor a destination is noise

        summary = _clean_text(
            fields.get("description")
            or fields.get("summary")
            or fields.get("content")
            or fields.get("encoded"),
            SUMMARY_LIMIT,
        )
        published = _parse_date(
            fields.get("pubDate") or fields.get("published") or fields.get("updated")
        )
        guid = fields.get("guid") or fields.get("id") or link

        parsed.append(
            {
                "guid_hash": hashlib.sha256(guid.encode("utf-8")).hexdigest(),
                "title": title[:500],
                "link": link[:2000],
                "summary": summary,
                "author": _clean_text(fields.get("creator") or fields.get("author"), 200),
                "published_at": published,
            }
        )
    return parsed


def parse_import(content: str) -> list[dict]:
    """Turn pasted text into feed specs.

    Accepts either an OPML export (what Feedly, Inoreader, NetNewsWire and most
    readers give you) or a plain list of URLs, one per line. Returns
    [{name, url, site_url}], deduplicated by URL, preserving order.
    """
    text = content.strip()
    if not text:
        return []

    specs: list[dict] = []
    looks_like_opml = text.startswith("<") and "outline" in text.lower()

    if looks_like_opml:
        try:
            root = ET.fromstring(text)
        except ET.ParseError as exc:
            raise FeedError(f"looks like OPML but is not valid XML ({exc})") from exc

        for outline in root.iter():
            if _strip_ns(outline.tag) != "outline":
                continue
            url = outline.get("xmlUrl") or outline.get("xmlurl")
            if not url:
                continue  # a folder row, not a feed
            name = (outline.get("title") or outline.get("text") or url).strip()
            specs.append(
                {
                    "name": name[:160],
                    "url": url.strip()[:1000],
                    "site_url": (outline.get("htmlUrl") or None),
                }
            )
    else:
        for line in text.splitlines():
            candidate = line.strip()
            # Tolerate "Name, https://..." and bare URLs alike.
            if not candidate or candidate.startswith("#"):
                continue
            match = re.search(r"https?://\S+", candidate)
            if not match:
                continue
            url = match.group(0).rstrip(",;")
            label = candidate[: match.start()].strip(" ,-\t") or None
            specs.append({"name": (label or url)[:160], "url": url[:1000], "site_url": None})

    seen: set[str] = set()
    unique: list[dict] = []
    for spec in specs:
        if spec["url"] in seen:
            continue
        seen.add(spec["url"])
        unique.append(spec)
    return unique


def fetch_feed(url: str) -> list[dict]:
    """Fetch and parse one feed, retrying transient failures.

    Retries 5xx/429 and network errors; a 4xx is treated as permanent (the feed
    really is gone, or the publisher blocks bots) and fails immediately.
    """
    last_error = FeedError("no attempt was made")

    for attempt in range(MAX_ATTEMPTS):
        try:
            response = httpx.get(
                url, timeout=FETCH_TIMEOUT, follow_redirects=True, headers=HEADERS
            )
        except httpx.HTTPError as exc:
            last_error = FeedError(f"unreachable: {type(exc).__name__}")
        else:
            if response.status_code in RETRY_STATUSES:
                last_error = FeedError(f"HTTP {response.status_code}")
            elif response.is_error:
                raise FeedError(f"HTTP {response.status_code}")
            else:
                return parse_feed(response.content)

        if attempt < MAX_ATTEMPTS - 1:
            time.sleep(0.8 * (attempt + 1))

    raise last_error


def refresh_feed(db: Session, feed: Feed) -> tuple[int, str | None]:
    """Refresh one feed. Returns (new article count, error message or None).

    Never raises: a broken feed records its error and the caller moves on.
    """
    now = _now()
    try:
        entries = fetch_feed(feed.url)
    except FeedError as exc:
        feed.last_fetched_at = now
        feed.last_status = "error"
        feed.last_error = str(exc)[:500]
        db.commit()
        return 0, str(exc)

    existing = set(
        db.scalars(select(Article.guid_hash).where(Article.feed_id == feed.id)).all()
    )

    added = 0
    seen_this_run: set[str] = set()
    for entry in entries:
        digest = entry["guid_hash"]
        # Guard against a feed repeating a guid inside a single response, which
        # would otherwise trip the unique constraint mid-transaction.
        if digest in existing or digest in seen_this_run:
            continue
        seen_this_run.add(digest)
        db.add(Article(feed_id=feed.id, fetched_at=now, **entry))
        added += 1

    feed.last_fetched_at = now
    feed.last_status = "ok"
    feed.last_error = None
    db.commit()
    return added, None


def refresh_all(db: Session, feed_ids: list[int] | None = None) -> dict:
    """Refresh every enabled feed (or a specific set). Reports per-feed outcomes."""
    stmt = select(Feed).where(Feed.is_enabled.is_(True)).order_by(Feed.id)
    if feed_ids:
        stmt = stmt.where(Feed.id.in_(feed_ids))

    results = []
    total_new = 0
    for feed in db.scalars(stmt).all():
        added, error = refresh_feed(db, feed)
        total_new += added
        results.append(
            {"feed_id": feed.id, "feed_name": feed.name, "new_articles": added, "error": error}
        )

    return {
        "refreshed_at": _now(),
        "feeds": len(results),
        "new_articles": total_new,
        "results": results,
    }


def prune_old_articles(db: Session, days: int | None = None) -> int:
    """Drop unsaved articles past the retention window. Saved ones are kept."""
    cutoff = _now() - timedelta(days=days or settings.news_retention_days)
    stale = db.scalars(
        select(Article).where(
            Article.is_saved.is_(False),
            Article.fetched_at < cutoff,
        )
    ).all()
    for article in stale:
        db.delete(article)
    db.commit()
    return len(stale)
