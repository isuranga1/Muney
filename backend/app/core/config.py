from functools import lru_cache
from pathlib import Path
from typing import Annotated

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


def _split_csv(value: str | list[str]) -> list[str]:
    """Accept either a real list or a plain comma-separated env string."""
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    return [part.strip() for part in value.split(",") if part.strip()]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_name: str = "Muney"
    api_prefix: str = "/api"
    debug: bool = False

    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/muney"

    jwt_secret: str = "change-me-to-a-long-random-string"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 14
    allow_bootstrap_registration: bool = True

    base_currency: str = "LKR"
    # NoDecode: keep pydantic-settings from JSON-parsing these before the
    # validator below gets a chance to split the plain comma-separated form.
    supported_currencies: Annotated[list[str], NoDecode] = [
        "LKR",
        "USD",
        "SGD",
        "EUR",
        "GBP",
        "AUD",
        "INR",
    ]

    # fawazahmed0/currency-api: free, no key, no rate limit, quotes LKR.
    # The pivot currency is part of the URL path, so if you change
    # fx_pivot_currency you must change both URLs to match.
    fx_api_url: str = (
        "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest"
        "/v1/currencies/usd.json"
    )
    # Same data, different host — used only if the primary fails.
    fx_fallback_api_url: str = "https://latest.currency-api.pages.dev/v1/currencies/usd.json"
    fx_pivot_currency: str = "USD"
    fx_stale_after_hours: int = 12
    # Shown beside the base currency on the dashboard, e.g. net worth in LKR
    # and USD. Empty turns the second column off.
    secondary_currency: str = "USD"

    # Shared secret the phone sends as `X-Ingest-Token` when forwarding a bank
    # SMS. Empty disables POST /api/ingest/sms entirely.
    ingest_token: str = ""
    # Two forwards of the same message inside this window count as one — an
    # iOS automation can fire twice for a single SMS.
    ingest_dedupe_minutes: int = 10

    # Reads SMS the regex parsers don't know and picks categories.
    #   llamacpp  — llama.cpp's llama-server on the Pi itself (compose default)
    #   anthropic — Claude API (needs ANTHROPIC_API_KEY); SMS text leaves the Pi
    #   none      — off; unparsed SMS wait in the inbox, keyword rules only
    llm_provider: str = "none"
    # A label for logs and the UI. With llamacpp the model is whatever the
    # server was started with (LLM_HF_MODEL in compose); keep this its --alias.
    llm_model: str = ""
    anthropic_api_key: str = ""
    llamacpp_url: str = "http://llm:8080"
    # Generous: on a Pi the first call after boot can still be warming up.
    llm_timeout_seconds: float = 120.0
    # Let the LLM add a category when nothing existing fits. Off means it can
    # only choose from what you have.
    llm_create_categories: bool = True

    # How often feeds refresh themselves in the background. 0 disables the
    # loop entirely and leaves refreshing to the button (or cron).
    news_refresh_minutes: int = 30
    # Unsaved articles older than this are pruned so the Pi's disk stays small.
    news_retention_days: int = 60

    cors_origins: Annotated[list[str], NoDecode] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

    @field_validator("supported_currencies", "cors_origins", mode="before")
    @classmethod
    def _parse_csv(cls, value: str | list[str]) -> list[str]:
        return _split_csv(value)

    @field_validator("base_currency", "fx_pivot_currency", "secondary_currency", mode="before")
    @classmethod
    def _upper(cls, value: str) -> str:
        return str(value).strip().upper()

    @property
    def currency_set(self) -> set[str]:
        return {c.upper() for c in self.supported_currencies} | {self.base_currency}


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
