"""Issue coturn REST credentials that expire; the shared secret stays on the server."""

import base64
import hashlib
import hmac
import time


def turn_credentials(urls: list[str], secret: str, user_id: int, ttl: int, *, now: float | None = None) -> list[dict]:
    if not urls and not secret:
        return []
    if not urls or not secret or not 60 <= ttl <= 86400 or any(not isinstance(url, str) or not url.startswith(("turn:", "turns:")) for url in urls):
        raise ValueError("TURN_URLS, TURN_SHARED_SECRET and TURN_TTL_SECONDS are invalid")
    username = f"{int(time.time() if now is None else now) + ttl}:{user_id}"
    signature = hmac.new(secret.encode(), username.encode(), hashlib.sha1).digest()
    return [{"urls": urls, "username": username, "credential": base64.b64encode(signature).decode()}]
