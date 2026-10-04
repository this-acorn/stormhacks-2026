import os
from functools import lru_cache
from pathlib import Path

from pydantic import SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/.env, located relative to this file so it's found from any folder.
ENV_FILE = Path(__file__).resolve().parent.parent / ".env"
# The test suite sets AIDATLAS_TESTING=1 so it never reads the real .env and its keys.
TESTING = os.environ.get("AIDATLAS_TESTING") == "1"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None if TESTING else ENV_FILE, env_ignore_empty=True, extra="ignore")

    # Any SQLAlchemy URL; replaces the TiDB settings below. The tests use in-memory SQLite.
    database_url: str | None = None

    tidb_host: str | None = None
    tidb_port: int = 4000
    tidb_user: str | None = None
    tidb_password: SecretStr | None = None
    tidb_db_name: str = "aidatlas"

    gemini_api_key: SecretStr | None = None
    gemini_model: str = "gemini-3.5-flash-lite"
    gemini_embed_model: str = "gemini-embedding-001"
    gemini_timeout_ms: int = 10000
    firms_map_key: SecretStr | None = None

    cors_origins: str = "http://localhost:5173"
    session_secret: SecretStr
    cookie_secure: bool = False  # set true when the site is served over HTTPS
    demo_controls: bool = True  # enables the replay and reset endpoints

    @model_validator(mode="after")
    def require_database(self) -> "Settings":
        if self.database_url is None:
            missing = [name.upper() for name in ("tidb_host", "tidb_user", "tidb_password") if getattr(self, name) is None]
            if missing:
                raise ValueError(f"Set {', '.join(missing)} in backend/.env")
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
