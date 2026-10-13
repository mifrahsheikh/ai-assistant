import json
import logging
import tempfile
import time
from pathlib import Path

from google.genai import types

from ..config import get_settings
from ..errors import friendly_error
from ..gemini import NO_AFC, get_client
from ..schemas import AgentInput, Upload

log = logging.getLogger("uvicorn.error")

STORE_FILE = Path("data/store.json")
ALLOWED = {".pdf", ".docx", ".xlsx", ".pptx", ".txt", ".md", ".csv", ".json", ".html"}
RAG_SYSTEM = (
    "Answer only from the user's documents. "
    "If the answer is not in them, say you could not find it in the documents."
)


def store_name() -> str:
    if get_settings().file_search_store_name:
        return get_settings().file_search_store_name
    if STORE_FILE.exists():
        return json.loads(STORE_FILE.read_text())["name"]
    return ""


def has_store() -> bool:
    return bool(store_name())


def ensure_store() -> str:
    name = store_name()
    if name:
        return name
    store = get_client().file_search_stores.create(
        config={"display_name": "assistant-docs"}
    )
    STORE_FILE.parent.mkdir(exist_ok=True)
    STORE_FILE.write_text(json.dumps({"name": store.name}))
    return store.name


def index_document(doc: Upload) -> None:
    suffix = Path(doc.name).suffix.lower()
    if suffix not in ALLOWED:
        raise ValueError("This file type is not supported.")
    client = get_client()
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(doc.data)
    try:
        op = client.file_search_stores.upload_to_file_search_store(
            file=tmp.name,
            file_search_store_name=ensure_store(),
            config={"display_name": doc.name},
        )
        deadline = time.time() + 120
        while not op.done:
            if time.time() > deadline:
                raise TimeoutError("Indexing took too long.")
            time.sleep(3)
            op = client.operations.get(op)
    finally:
        Path(tmp.name).unlink(missing_ok=True)


def citations_from(res) -> list[dict]:
    seen, items = set(), []
    for cand in res.candidates or []:
        meta = cand.grounding_metadata
        for chunk in (meta.grounding_chunks or []) if meta else []:
            ctx = chunk.retrieved_context
            if ctx and ctx.title and ctx.title not in seen:
                seen.add(ctx.title)
                items.append({"title": ctx.title, "snippet": (ctx.text or "")[:200]})
    return items


def run(inp: AgentInput):
    question = inp.history[-1]["content"].strip()
    if inp.document:
        try:
            index_document(inp.document)
        except ValueError as e:
            yield {"type": "error", "message": str(e)}
            return
        except Exception as exc:
            log.exception("indexing failed")
            yield {
                "type": "error",
                "message": friendly_error(exc, "Could not index that file. Try again."),
            }
            return
        if not question:
            yield {
                "type": "text",
                "text": f"Indexed {inp.document.name}. Ask me anything about it.",
            }
            return
    if not has_store():
        yield {"type": "error", "message": "Upload a document first."}
        return
    res = get_client().models.generate_content(
        model=get_settings().gemini_model,
        contents=question,
        config=types.GenerateContentConfig(
            system_instruction=RAG_SYSTEM,
            automatic_function_calling=NO_AFC,
            tools=[
                types.Tool(
                    file_search=types.FileSearch(file_search_store_names=[store_name()])
                )
            ],
        ),
    )
    yield {
        "type": "text",
        "text": res.text or "I could not find that in the documents.",
    }
    yield {"type": "citations", "items": citations_from(res)}
