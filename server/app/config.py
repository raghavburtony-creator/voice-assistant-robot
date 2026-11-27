from pathlib import Path
import re
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
    # Cross-session continuity is disabled unless the deployment explicitly trusts a host/proxy boundary.
    # The browser cannot set these WebSocket handshake headers itself.
    continuity_trust_proxy: bool = False
    continuity_store_path: str = str(SERVER_DIR / "data" / "continuity.sqlite3")
    # Explicitly opted-in, host-identity-scoped memory; no browser-supplied identity is trusted.
    memory_store_path: str = str(SERVER_DIR / "data" / "memory.sqlite3")
    # Explicitly installed extension packages are enabled per deployment; empty means none.
    otto_enabled_extensions: str = ""

    @field_validator("cors_origins")
    @classmethod
    def _no_wildcard(cls, value: str) -> str:
        if "*" in [origin.strip() for origin in value.split(",")]:
            raise ValueError("CORS_ORIGINS must list explicit origins; a wildcard is not allowed")
        return value

    @field_validator("otto_enabled_extensions")
    @classmethod
    def _valid_enabled_extensions(cls, value: str) -> str:
        identifiers = [item.strip() for item in value.split(",") if item.strip()]
        if len(identifiers) > 8 or len(set(identifiers)) != len(identifiers):
            raise ValueError("OTTO_ENABLED_EXTENSIONS may contain at most eight unique ids")
        if any(not re.fullmatch(r"[a-z][a-z0-9_-]{0,23}", item) for item in identifiers):
            raise ValueError("OTTO_ENABLED_EXTENSIONS must use lowercase extension ids")
        return ",".join(identifiers)

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def enabled_extension_ids(self) -> tuple[str, ...]:
        """Deployment-approved extension entry-point ids; no extension is enabled by default."""
        return tuple(item for item in self.otto_enabled_extensions.split(",") if item)

    @property
    def origin_required(self) -> bool:
        """True in production (any non-local origin listed): a WebSocket with no Origin header is refused."""
        return any(urlparse(origin).hostname not in ("localhost", "127.0.0.1") for origin in self.cors_origin_list)


settings = Settings()
