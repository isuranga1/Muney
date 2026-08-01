from fastapi import APIRouter, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app.api.deps import CurrentUser, DbSession
from app.models import Article, Feed, FeedGroup
from app.schemas.news import (
    ArticleRead,
    ArticleUpdate,
    FeedCreate,
    FeedGroupCreate,
    FeedGroupRead,
    FeedGroupUpdate,
    FeedRead,
    FeedTestResult,
    FeedUpdate,
    ImportResult,
    RefreshResult,
)
from app.services import rss

router = APIRouter(tags=["news"])


def _get_group(db: DbSession, group_id: int) -> FeedGroup:
    group = db.scalar(
        select(FeedGroup).where(FeedGroup.id == group_id).options(selectinload(FeedGroup.feeds))
    )
    if group is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feed group not found")
    return group


def _get_feed(db: DbSession, feed_id: int) -> Feed:
    feed = db.get(Feed, feed_id)
    if feed is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feed not found")
    return feed


def _article_counts(db: DbSession) -> tuple[dict[int, int], dict[int, int]]:
    """Per-feed totals in two queries rather than one per feed."""
    totals = dict(
        db.execute(select(Article.feed_id, func.count()).group_by(Article.feed_id)).all()
    )
    unread = dict(
        db.execute(
            select(Article.feed_id, func.count())
            .where(Article.is_read.is_(False))
            .group_by(Article.feed_id)
        ).all()
    )
    return totals, unread


def _feed_read(feed: Feed, totals: dict[int, int], unread: dict[int, int]) -> FeedRead:
    out = FeedRead.model_validate(feed)
    out.article_count = totals.get(feed.id, 0)
    out.unread_count = unread.get(feed.id, 0)
    return out


# ---------------------------------------------------------------- groups

@router.get("/feed-groups", response_model=list[FeedGroupRead])
def list_feed_groups(
    db: DbSession, current_user: CurrentUser, include_archived: bool = False
) -> list[FeedGroupRead]:
    stmt = (
        select(FeedGroup)
        .options(selectinload(FeedGroup.feeds))
        .order_by(FeedGroup.sort_order, FeedGroup.name)
    )
    if not include_archived:
        stmt = stmt.where(FeedGroup.is_archived.is_(False))

    totals, unread = _article_counts(db)
    groups = []
    for group in db.scalars(stmt).all():
        out = FeedGroupRead.model_validate(group)
        out.feeds = [_feed_read(f, totals, unread) for f in group.feeds]
        out.article_count = sum(f.article_count for f in out.feeds)
        out.unread_count = sum(f.unread_count for f in out.feeds)
        groups.append(out)
    return groups


@router.post("/feed-groups", response_model=FeedGroupRead, status_code=status.HTTP_201_CREATED)
def create_feed_group(
    payload: FeedGroupCreate, db: DbSession, current_user: CurrentUser
) -> FeedGroupRead:
    group = FeedGroup(**payload.model_dump())
    db.add(group)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A feed group named {payload.name!r} already exists",
        ) from exc
    db.refresh(group)
    return FeedGroupRead.model_validate(group)


@router.patch("/feed-groups/{group_id}", response_model=FeedGroupRead)
def update_feed_group(
    group_id: int, payload: FeedGroupUpdate, db: DbSession, current_user: CurrentUser
) -> FeedGroupRead:
    group = _get_group(db, group_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(group, field, value)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="A group with that name already exists"
        ) from exc
    db.refresh(group)
    totals, unread = _article_counts(db)
    out = FeedGroupRead.model_validate(group)
    out.feeds = [_feed_read(f, totals, unread) for f in group.feeds]
    return out


@router.delete("/feed-groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_feed_group(group_id: int, db: DbSession, current_user: CurrentUser) -> Response:
    """Removes the group, its feeds, and their stored articles."""
    db.delete(_get_group(db, group_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ----------------------------------------------------------------- feeds

@router.get("/feeds", response_model=list[FeedRead])
def list_feeds(db: DbSession, current_user: CurrentUser) -> list[FeedRead]:
    totals, unread = _article_counts(db)
    feeds = db.scalars(select(Feed).order_by(Feed.sort_order, Feed.id)).all()
    return [_feed_read(f, totals, unread) for f in feeds]


@router.post("/feeds", response_model=FeedRead, status_code=status.HTTP_201_CREATED)
def create_feed(payload: FeedCreate, db: DbSession, current_user: CurrentUser) -> FeedRead:
    if payload.group_id is not None:
        _get_group(db, payload.group_id)
    feed = Feed(**payload.model_dump())
    db.add(feed)
    db.commit()
    db.refresh(feed)

    # Pull straight away so a new feed is not an empty card.
    rss.refresh_feed(db, feed)
    db.refresh(feed)
    totals, unread = _article_counts(db)
    return _feed_read(feed, totals, unread)


@router.patch("/feeds/{feed_id}", response_model=FeedRead)
def update_feed(
    feed_id: int, payload: FeedUpdate, db: DbSession, current_user: CurrentUser
) -> FeedRead:
    feed = _get_feed(db, feed_id)
    data = payload.model_dump(exclude_unset=True)
    if data.get("group_id") is not None:
        _get_group(db, data["group_id"])
    for field, value in data.items():
        setattr(feed, field, value)
    db.commit()
    db.refresh(feed)
    totals, unread = _article_counts(db)
    return _feed_read(feed, totals, unread)


@router.delete("/feeds/{feed_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_feed(feed_id: int, db: DbSession, current_user: CurrentUser) -> Response:
    db.delete(_get_feed(db, feed_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


class FeedTestRequest(BaseModel):
    url: str


@router.post("/feeds/test", response_model=FeedTestResult)
def test_feed(payload: FeedTestRequest, current_user: CurrentUser) -> FeedTestResult:
    """Check a URL before saving it — many news sites 403 or serve HTML."""
    try:
        entries = rss.fetch_feed(payload.url)
    except rss.FeedError as exc:
        return FeedTestResult(ok=False, url=payload.url, error=str(exc))
    return FeedTestResult(
        ok=True,
        url=payload.url,
        item_count=len(entries),
        sample_titles=[e["title"] for e in entries[:3]],
    )


# -------------------------------------------------------------- articles

@router.get("/articles", response_model=list[ArticleRead])
def list_articles(
    db: DbSession,
    current_user: CurrentUser,
    group_id: int | None = None,
    feed_id: int | None = None,
    unread_only: bool = False,
    saved_only: bool = False,
    search: str | None = None,
    limit: int = Query(default=60, ge=1, le=300),
    offset: int = Query(default=0, ge=0),
) -> list[ArticleRead]:
    stmt = (
        select(Article, Feed, FeedGroup)
        .join(Feed, Article.feed_id == Feed.id)
        .outerjoin(FeedGroup, Feed.group_id == FeedGroup.id)
        # Undated entries sort last rather than being scattered through the list.
        .order_by(Article.published_at.desc().nulls_last(), Article.id.desc())
        .limit(limit)
        .offset(offset)
    )
    if group_id is not None:
        stmt = stmt.where(Feed.group_id == group_id)
    if feed_id is not None:
        stmt = stmt.where(Article.feed_id == feed_id)
    if unread_only:
        stmt = stmt.where(Article.is_read.is_(False))
    if saved_only:
        stmt = stmt.where(Article.is_saved.is_(True))
    if search:
        needle = f"%{search.strip()}%"
        stmt = stmt.where(Article.title.ilike(needle) | Article.summary.ilike(needle))

    out = []
    for article, feed, group in db.execute(stmt).all():
        item = ArticleRead.model_validate(article)
        item.feed_name = feed.name
        item.group_name = group.name if group else None
        out.append(item)
    return out


@router.patch("/articles/{article_id}", response_model=ArticleRead)
def update_article(
    article_id: int, payload: ArticleUpdate, db: DbSession, current_user: CurrentUser
) -> ArticleRead:
    article = db.get(Article, article_id)
    if article is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Article not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(article, field, value)
    db.commit()
    db.refresh(article)
    return ArticleRead.model_validate(article)


class MarkReadRequest(BaseModel):
    group_id: int | None = None
    feed_id: int | None = None


@router.post("/articles/mark-all-read", response_model=dict)
def mark_all_read(
    payload: MarkReadRequest, db: DbSession, current_user: CurrentUser
) -> dict:
    stmt = select(Article).where(Article.is_read.is_(False))
    if payload.feed_id is not None:
        stmt = stmt.where(Article.feed_id == payload.feed_id)
    elif payload.group_id is not None:
        feed_ids = db.scalars(select(Feed.id).where(Feed.group_id == payload.group_id)).all()
        stmt = stmt.where(Article.feed_id.in_(feed_ids or [-1]))

    rows = db.scalars(stmt).all()
    for article in rows:
        article.is_read = True
    db.commit()
    return {"marked_read": len(rows)}


# --------------------------------------------------------------- refresh

@router.post("/news/refresh", response_model=RefreshResult)
def refresh_news(
    db: DbSession,
    current_user: CurrentUser,
    feed_id: int | None = None,
) -> RefreshResult:
    """Fetch every enabled feed (or one). A failing feed is reported, not fatal."""
    result = rss.refresh_all(db, [feed_id] if feed_id else None)
    rss.prune_old_articles(db)
    return RefreshResult(**result)


class ImportRequest(BaseModel):
    """Bring feeds in from anywhere: an OPML export or a pasted list of URLs."""

    content: str
    group_id: int | None = None
    new_group_name: str | None = Field(default=None, max_length=120)
    # Off by default: importing 50 feeds would otherwise mean 50 blocking fetches.
    verify: bool = False


@router.post("/feeds/import", response_model=ImportResult)
def import_feeds(payload: ImportRequest, db: DbSession, current_user: CurrentUser) -> ImportResult:
    try:
        specs = rss.parse_import(payload.content)
    except rss.FeedError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    if not specs:
        raise HTTPException(
            status_code=422,
            detail="Nothing to import — paste an OPML export or one feed URL per line.",
        )

    group_id = payload.group_id
    if payload.new_group_name:
        name = payload.new_group_name.strip()
        group = db.scalar(select(FeedGroup).where(FeedGroup.name == name))
        if group is None:
            group = FeedGroup(name=name)
            db.add(group)
            db.commit()
            db.refresh(group)
        group_id = group.id
    elif group_id is not None:
        _get_group(db, group_id)

    known = set(db.scalars(select(Feed.url)).all())
    created: list[Feed] = []
    skipped = 0
    for index, spec in enumerate(specs):
        if spec["url"] in known:
            skipped += 1
            continue
        known.add(spec["url"])
        feed = Feed(group_id=group_id, sort_order=index, **spec)
        db.add(feed)
        created.append(feed)
    db.commit()

    failed: list[str] = []
    if payload.verify:
        for feed in created:
            db.refresh(feed)
            _, error = rss.refresh_feed(db, feed)
            if error:
                failed.append(f"{feed.name}: {error}")

    totals, unread = _article_counts(db)
    for feed in created:
        db.refresh(feed)

    return ImportResult(
        imported=len(created),
        skipped=skipped,
        failed=failed,
        feeds=[_feed_read(f, totals, unread) for f in created],
    )
