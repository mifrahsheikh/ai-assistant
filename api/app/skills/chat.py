from google.genai import types

from ..config import get_settings
from ..gemini import NO_AFC, get_client
from ..schemas import AgentInput

SYSTEM = "You are a helpful assistant. Be clear and concise."


def to_contents(history: list[dict]) -> list[types.Content]:
    return [
        types.Content(
            role="user" if m["role"] == "user" else "model",
            parts=[types.Part.from_text(text=m["content"])],
        )
        for m in history
        if m["content"]
    ]


def stream_chat(history: list[dict], system: str = SYSTEM):
    stream = get_client().models.generate_content_stream(
        model=get_settings().gemini_model,
        contents=to_contents(history),
        config=types.GenerateContentConfig(
            system_instruction=system,
            temperature=0.7,
            automatic_function_calling=NO_AFC,
        ),
    )
    for chunk in stream:
        if chunk.text:
            yield chunk.text


def run(inp: AgentInput):
    for text in stream_chat(inp.history):
        yield {"type": "text", "text": text}
