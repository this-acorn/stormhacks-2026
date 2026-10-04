import asyncio
import logging
from contextlib import asynccontextmanager, suppress
from datetime import UTC, datetime

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.config import TESTING, get_settings
from app.education import education_store
from app.live_fires import keep_fresh as keep_fires_fresh
from app.nature_overview import overview_store
from app.db import engine, is_tidb
from app.errors import install_error_handlers
from app.routers import contributions, hazards, observations, organizations, search, session

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
settings = get_settings()

@asynccontextmanager
async def lifespan(_app):
    tasks = [] if TESTING else [
        asyncio.create_task(education_store.run()),
        asyncio.create_task(overview_store.run()),
        asyncio.create_task(keep_fires_fresh()),
    ]
    try:
        yield
    finally:
        for task in tasks:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task


app = FastAPI(
    title="AidAtlas API",
    version="1.0.0",
    lifespan=lifespan,
    description="Satellite observations → nearby organizations → confirmed requests → supporters → contributions.",
)
install_error_handlers(app)

# Compress large responses, such as thousands of fire detections.
app.add_middleware(GZipMiddleware, minimum_size=1000)
# Let the frontend's dev server call us from the browser (CORS_ORIGINS in .env). Added last, so it runs first.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Every endpoint lives under /api/v1, as in API_CONTRACT.md.
api = APIRouter(prefix="/api/v1")


@api.get("/health", tags=["health"])
def health():
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        database = "connected"
    except SQLAlchemyError:
        database = "error"
    return {
        "status": "ok",
        "database": database,
        "gemini": "configured" if settings.gemini_api_key else "missing",
        "vectorSearch": "tidb" if is_tidb() else "unavailable",
        "time": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


for module in (session, organizations, observations, contributions, search, hazards):
    api.include_router(module.router)
app.include_router(api)
