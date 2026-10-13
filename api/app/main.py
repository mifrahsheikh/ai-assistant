import json
import logging
from typing import Annotated

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .agent import run_agent
from .config import get_settings
from .errors import friendly_error
from .schemas import AgentInput, Upload

log = logging.getLogger("uvicorn.error")

MAX_BYTES = 15 * 1024 * 1024  # keeps requests under Gemini's 20 MB inline limit

app = FastAPI(title="AI Assistant API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[get_settings().allowed_origin],
    allow_methods=["*"],
    allow_headers=["*"],
)


def sse(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


async def read_upload(f: UploadFile | None) -> Upload | None:
    if f is None:
        return None
    data = await f.read()
    if len(data) > MAX_BYTES:
        raise ValueError("File is too large. The limit is 15 MB.")
    return Upload(
        f.filename or "upload", data, f.content_type or "application/octet-stream"
    )


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/api/agent")
async def agent(
    messages: Annotated[str, Form()],  # JSON list of {role, content}
    audio: Annotated[UploadFile | None, File()] = None,
    image: Annotated[UploadFile | None, File()] = None,
    document: Annotated[UploadFile | None, File()] = None,
):
    try:
        inp = AgentInput(
            history=json.loads(messages),
            audio=await read_upload(audio),
            image=await read_upload(image),
            document=await read_upload(document),
        )
    except ValueError as e:
        return StreamingResponse(
            iter([sse({"type": "error", "message": str(e)})]),
            media_type="text/event-stream",
        )

    def events():
        try:
            for event in run_agent(inp):
                yield sse(event)
        except Exception as exc:
            # The real error goes to the server log, never to the browser.
            log.exception("agent request failed")
            yield sse({"type": "error", "message": friendly_error(exc)})

    return StreamingResponse(events(), media_type="text/event-stream")
