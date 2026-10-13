import os

os.environ.setdefault("GEMINI_API_KEY", "test-key")

from fastapi.testclient import TestClient

from app import main
from app.errors import friendly_error

BODY = {"messages": '[{"role":"user","content":"hi"}]'}


class FakeGoogleError(Exception):
    def __init__(self, code: int, text: str = ""):
        super().__init__(text)
        self.code = code


def test_invalid_key_message():
    msg = friendly_error(FakeGoogleError(400, "400 INVALID_ARGUMENT API_KEY_INVALID"))
    assert "API key is not valid" in msg


def test_quota_and_missing_model_messages():
    assert "quota" in friendly_error(FakeGoogleError(429))
    assert "model" in friendly_error(FakeGoogleError(404))
    assert "rejected" in friendly_error(FakeGoogleError(403))


def test_unknown_errors_use_the_default_and_hide_details():
    msg = friendly_error(RuntimeError("secret-key-123"))
    assert "secret-key-123" not in msg
    assert msg == "The model request failed. Try again."


def test_endpoint_shows_the_friendly_key_message(monkeypatch):
    def boom(inp):
        raise FakeGoogleError(400, "API key not valid. API_KEY_INVALID abc-secret")

    monkeypatch.setattr(main, "run_agent", boom)
    res = TestClient(main.app).post("/api/agent", data=BODY)
    assert "API key is not valid" in res.text
    assert "abc-secret" not in res.text


def test_real_google_error_from_the_logs_is_recognised():
    from google.genai import errors

    body = {
        "error": {
            "code": 400,
            "message": "API key not valid. Please pass a valid API key.",
            "status": "INVALID_ARGUMENT",
            "details": [{"reason": "API_KEY_INVALID"}],
        }
    }
    exc = errors.ClientError(400, body, None)
    assert "API key is not valid" in friendly_error(exc)
