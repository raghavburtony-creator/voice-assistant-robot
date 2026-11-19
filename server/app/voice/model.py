"""The Gemini model with the server's key.

ADK's `Gemini` has no API-key field and otherwise reads environment variables. The key comes from settings and never goes into
os.environ, so it is passed through `client_kwargs`, which ADK applies to both the request client and the Live client.
"""
from __future__ import annotations

from google.adk.models import BaseLlm, Gemini
from google.genai import types

from app.config import settings


def keyed_model(name: str) -> BaseLlm:
    return Gemini(
        model=name,
        client_kwargs={
            "api_key": settings.gemini_api_key.get_secret_value(),
            "http_options": types.HttpOptions(api_version=settings.gemini_api_version),
        },
    )
