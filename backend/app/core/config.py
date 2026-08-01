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

    cors_origins: Annotated[list[str], NoDecode] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

    @field_validator("supported_currencies", "cors_origins", mode="before")
    @classmethod
    def _parse_csv(cls, value: str | list[str]) -> list[str]:
        return _split_csv(value)

    @field_validator("base_currency", "fx_pivot_currency", mode="before")
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
