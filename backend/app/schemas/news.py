from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import ORMModel


class ArticleRead(ORMModel):
    id: int
    feed_id: int
    title: str
    link: str
    summary: str | None
    author: str | None
    published_at: datetime | None
    fetched_at: datetime
    is_read: bool
    is_saved: bool

    # Filled in by the API layer so a card can show its origin without a join.
    feed_name: str | None = None
    group_name: str | None = None


class ArticleUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    is_read: bool | None = None
    is_saved: bool | None = None


class FeedCreate(BaseModel):
    group_id: int | None = None
    name: str = Field(min_length=1, max_length=160)
    url: str = Field(min_length=4, max_length=1000)
    site_url: str | None = Field(default=None, max_length=1000)
    notes: str | None = None
    sort_order: int = 0
    is_enabled: bool = True


class FeedUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    group_id: int | None = None
    name: str | None = Field(default=None, min_length=1, max_length=160)
    url: str | None = Field(default=None, min_length=4, max_length=1000)
    site_url: str | None = Field(default=None, max_length=1000)
    notes: str | None = None
    sort_order: int | None = None
    is_enabled: bool | None = None


class FeedRead(ORMModel):
    id: int
    group_id: int | None
    name: str
    url: str
    site_url: str | None
    notes: str | None
    sort_order: int
    is_enabled: bool
    last_fetched_at: datetime | None
    last_status: str | None
    last_error: str | None

    article_count: int = 0
    unread_count: int = 0


class FeedGroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = None
    color: str | None = Field(default=None, max_length=9)
    sort_order: int = 0
    is_archived: bool = False


class FeedGroupUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    color: str | None = Field(default=None, max_length=9)
    sort_order: int | None = None
    is_archived: bool | None = None


class FeedGroupRead(ORMModel):
    id: int
    name: str
    description: str | None
    color: str | None
    sort_order: int
    is_archived: bool
    feeds: list[FeedRead] = []

    article_count: int = 0
    unread_count: int = 0


class RefreshResultItem(BaseModel):
    feed_id: int
    feed_name: str
    new_articles: int
    error: str | None = None


class RefreshResult(BaseModel):
    refreshed_at: datetime
    feeds: int
    new_articles: int
    results: list[RefreshResultItem]


class ImportResult(BaseModel):
    imported: int
    skipped: int
    failed: list[str] = []
    feeds: list[FeedRead] = []


class FeedTestResult(BaseModel):
    """Dry run of a URL before it is saved as a feed."""

    ok: bool
    url: str
    item_count: int = 0
    error: str | None = None
    sample_titles: list[str] = []
