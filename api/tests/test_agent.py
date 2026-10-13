import os

os.environ.setdefault("GEMINI_API_KEY", "test-key")

from fastapi.testclient import TestClient

from app import agent, main
from app.schemas import AgentInput, Upload

UP = Upload("x", b"1", "application/octet-stream")
BODY = {"messages": '[{"role":"user","content":"hi"}]'}


def make(text="hi", **kw):
    return AgentInput(history=[{"role": "user", "content": text}], **kw)


def test_attachments_choose_the_skill():
    assert agent.route(make(audio=UP)) == "voice"
    assert agent.route(make(image=UP)) == "image"
    assert agent.route(make(document=UP)) == "file"


def test_text_goes_to_chat_without_documents(monkeypatch):
    monkeypatch.setattr(agent.file, "has_store", lambda: False)
    assert agent.route(make()) == "chat"


def test_text_goes_to_file_when_the_model_says_yes(monkeypatch):
    monkeypatch.setattr(agent.file, "has_store", lambda: True)
    monkeypatch.setattr(agent, "wants_documents", lambda text: True)
    assert agent.route(make("What does my PDF say?")) == "file"


def test_endpoint_streams_events(monkeypatch):
    events = [{"type": "text", "text": "Hello"}, {"type": "done"}]
    monkeypatch.setattr(main, "run_agent", lambda inp: iter(events))
    res = TestClient(main.app).post("/api/agent", data=BODY)
    assert res.status_code == 200
    assert '"text": "Hello"' in res.text


def test_errors_do_not_leak_details(monkeypatch):
    def boom(inp):
        raise RuntimeError("secret-key-123")

    monkeypatch.setattr(main, "run_agent", boom)
    res = TestClient(main.app).post("/api/agent", data=BODY)
    assert "secret-key-123" not in res.text
    assert "failed" in res.text


def test_oversized_upload_is_rejected():
    big = b"0" * (main.MAX_BYTES + 1)
    res = TestClient(main.app).post(
        "/api/agent", data=BODY, files={"document": ("big.pdf", big, "application/pdf")}
    )
    assert "too large" in res.text


def test_unsupported_image_type_is_rejected():
    from app.skills import image

    inp = make(image=Upload("a.gif", b"1", "image/gif"))
    events = list(image.run(inp))
    assert events[0]["type"] == "error"
