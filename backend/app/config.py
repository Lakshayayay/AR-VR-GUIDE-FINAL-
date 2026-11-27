"""Settings, all read from environment variables. See backend/.env.example."""

import json
import os
from pathlib import Path

from .turn import turn_credentials

DATA_DIR = Path(os.getenv("DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR = DATA_DIR / "uploads"

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DATA_DIR / 'arguide.db'}")


# Who may open a live connection. "*" is for local development only;
# set the web app's address in production, e.g. "https://arguide.example.com".
_origins = os.getenv("ALLOWED_ORIGINS", "*")
ALLOWED_ORIGINS: str | list[str] = "*" if _origins == "*" else [o.strip() for o in _origins.split(",")]

# Servers that help two devices find each other for video. On a closed network,
# set this to your own relay (coturn), or to [] when both devices share one network.
ICE_SERVERS = json.loads(os.getenv("ICE_SERVERS", '[{"urls": "stun:stun.l.google.com:19302"}]'))
TURN_URLS = json.loads(os.getenv("TURN_URLS", "[]"))
TURN_SHARED_SECRET = os.getenv("TURN_SHARED_SECRET", "")
TURN_TTL_SECONDS = int(os.getenv("TURN_TTL_SECONDS", "3600"))
if not isinstance(TURN_URLS, list) or bool(TURN_URLS) != bool(TURN_SHARED_SECRET) or not 60 <= TURN_TTL_SECONDS <= 86400:
    raise ValueError("TURN_URLS and TURN_SHARED_SECRET must both be configured; TTL must be 60 to 86400 seconds")
turn_credentials(TURN_URLS, TURN_SHARED_SECRET, 0, TURN_TTL_SECONDS, now=0)  # fail fast on bad relay URLs
