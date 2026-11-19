from pathlib import Path
from urllib.parse import urlparse

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

SERVER_DIR = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    """Loaded from environment variables and server/.env. Real environment variables win."""

    model_config = SettingsConfigDict(env_file=SERVER_DIR / ".env", env_file_encoding="utf-8", env_ignore_empty=True, extra="ignore")

    app_name: str = "Otto Demo"

    # Comma-separated explicit origins. The voice WebSocket checks it too. No wildcard.
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # Left unset, the server starts and the voice guide reports it is not set up.
    gemini_api_key: SecretStr = SecretStr("")
    # A Gemini Live (native audio) model. Check the current ids at https://ai.google.dev/gemini-api/docs/models
    gemini_live_model: str = "gemini-3.8-live"
    # Live models are served on v1beta; the SDK's default v1 answers 404 for them.
    gemini_api_version: str = "v1beta"
    # Live audio is billed per minute and there are no accounts, so sessions are capped in length and number.
    max_session_seconds: int = Field(default=600, gt=0)
    max_sessions: int = Field(default=4, gt=0)

    @field_validator("cors_origins")
    @classmethod
    def _no_wildcard(cls, value: str) -> str:
        if "*" in [origin.strip() for origin in value.split(",")]:
            raise ValueError("CORS_ORIGINS must list explicit origins; a wildcard is not allowed")
        return value

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def origin_required(self) -> bool:
        """True in production (any non-local origin listed): a WebSocket with no Origin header is refused."""
        return any(urlparse(origin).hostname not in ("localhost", "127.0.0.1") for origin in self.cors_origin_list)


settings = Settings()
