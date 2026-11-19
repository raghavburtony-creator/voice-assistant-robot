import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.voice.route import router as voice_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(name)s | %(message)s")

app = FastAPI(title=settings.app_name)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origin_list, allow_methods=["GET", "POST", "OPTIONS"],
                   allow_headers=["Content-Type"])


@app.get("/api/v1/health")
def health() -> dict:
    return {"status": "ok", "voice": bool(settings.gemini_api_key.get_secret_value())}


app.include_router(voice_router)
