import logging

from google.genai import types

from .config import get_settings
from .gemini import NO_AFC, get_client
from .schemas import AgentInput
from .skills import chat, file, image, voice

log = logging.getLogger("uvicorn.error")

SKILLS = {"chat": chat.run, "image": image.run, "voice": voice.run, "file": file.run}


def wants_documents(text: str) -> bool:
    """Ask the model whether the user's uploaded files can answer this."""
    prompt = (
        "Answer only YES or NO. Would this question be answered by the user's "
        f"uploaded documents?\n\nQuestion: {text}"
    )
    try:
        res = get_client().models.generate_content(
            model=get_settings().gemini_model,
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=0, automatic_function_calling=NO_AFC
            ),
        )
        return (res.text or "").strip().upper().startswith("YES")
    except Exception:
        log.exception("document check failed, falling back to chat")
        return False


def route(inp: AgentInput) -> str:
    if inp.audio:
        return "voice"
    if inp.image:
        return "image"
    if inp.document:
        return "file"
    if file.has_store() and wants_documents(inp.history[-1]["content"]):
        return "file"
    return "chat"


def run_agent(inp: AgentInput):
    name = route(inp)
    yield {"type": "skill", "name": name}  # the UI shows which skill ran
    yield from SKILLS[name](inp)
    yield {"type": "done"}
