from google.genai import types

from ..config import get_settings
from ..gemini import NO_AFC, get_client
from ..schemas import AgentInput

ALLOWED = {"image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"}


def run(inp: AgentInput):
    img = inp.image
    if img.mime not in ALLOWED:
        yield {"type": "error", "message": "Use a PNG, JPEG, WebP, HEIC or HEIF image."}
        return
    question = inp.history[-1]["content"] or "Describe this image."
    stream = get_client().models.generate_content_stream(
        model=get_settings().gemini_model,
        contents=[types.Part.from_bytes(data=img.data, mime_type=img.mime), question],
        config=types.GenerateContentConfig(automatic_function_calling=NO_AFC),
    )
    for chunk in stream:
        if chunk.text:
            yield {"type": "text", "text": chunk.text}
