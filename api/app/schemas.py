from dataclasses import dataclass


@dataclass
class Upload:
    name: str
    data: bytes
    mime: str


@dataclass
class AgentInput:
    # [{"role": "user" | "assistant", "content": str}], the last item is the new message
    history: list[dict]
    audio: Upload | None = None
    image: Upload | None = None
    document: Upload | None = None
