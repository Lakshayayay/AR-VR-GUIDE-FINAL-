"""Starts the API and the live connection together.

Run: uv run uvicorn app.main:app --reload --port 8000
"""

from contextlib import asynccontextmanager

import socketio
from fastapi import FastAPI

from .api import router as api_router
from .auth import router as auth_router
from .db import init_db
from .realtime import sio, watch_open_calls

init_db()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    watch_open_calls()
    yield


api = FastAPI(title="ArGuide API", docs_url="/api/docs", openapi_url="/api/openapi.json", lifespan=lifespan)
api.include_router(auth_router)
api.include_router(api_router)


@api.get("/api/health")
def health():
    return {"ok": True}


app = socketio.ASGIApp(sio, other_asgi_app=api)
