import base64
import hashlib
import hmac

from app.turn import turn_credentials


def test_turn_credentials_are_expiring_and_signed_without_exposing_secret():
    servers = turn_credentials(["turn:relay.example:3478", "turns:relay.example:5349"], "test-secret", 42, 3600, now=1000)
    assert servers[0]["username"] == "4600:42"
    expected = base64.b64encode(hmac.new(b"test-secret", b"4600:42", hashlib.sha1).digest()).decode()
    assert servers[0]["credential"] == expected
    assert "test-secret" not in str(servers)


def test_turn_is_disabled_without_relay_configuration():
    assert turn_credentials([], "", 42, 3600, now=1000) == []
