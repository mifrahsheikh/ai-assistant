import base64
import io
import logging
import wave

from google.genai import types

from ..config import get_settings
from ..gemini import NO_AFC, get_client
from ..schemas import AgentInput, Upload
from .chat import stream_chat

log = logging.getLogger("uvicorn.error")

SPOKEN = "You are a voice assistant. Answer in at most three short sentences, in plain words."


def transcribe(audio: Upload) -> str:
    mime = audio.mime.split(";")[0]  # "audio/webm;codecs=opus" becomes "audio/webm"
    res = get_client().models.generate_content(
        model=get_settings().gemini_model,
        contents=[
            types.Part.from_bytes(data=audio.data, mime_type=mime),
            "Transcribe this audio exactly. Return only the transcript.",
        ],
        config=types.GenerateContentConfig(automatic_function_calling=NO_AFC),
    )
    return (res.text or "").strip()


def pcm_to_wav(pcm: bytes, rate: int = 24000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue()


def speak(text: str) -> bytes:
    s = get_settings()
    client = get_client()
    try:  # the form shown on Google's speech generation page
        out = client.interactions.create(
            model=s.gemini_tts_model,
            input=[{"type": "user_input", "content": [{"type": "text", "text": text}]}],
            response_format={"type": "audio"},
            generation_config={"speech_config": [{"voice": s.gemini_tts_voice}]},
        )
        return base64.b64decode(out.output_audio.data)
    except AttributeError:  # older SDK without the interactions API
        res = client.models.generate_content(
            model=s.gemini_tts_model,
            contents=text,
            config=types.GenerateContentConfig(
                response_modalities=["AUDIO"],
                speech_config=types.SpeechConfig(
                    voice_config=types.VoiceConfig(
                        prebuilt_voice_config=types.PrebuiltVoiceConfig(
                            voice_name=s.gemini_tts_voice
                        )
                    )
                ),
            ),
        )
        pcm = res.candidates[0].content.parts[0].inline_data.data
        return pcm if pcm[:4] == b"RIFF" else pcm_to_wav(pcm)


def run(inp: AgentInput):
    transcript = transcribe(inp.audio)
    if not transcript:
        yield {"type": "error", "message": "I could not hear anything. Try again."}
        return
    yield {"type": "transcript", "text": transcript}
    history = [*inp.history[:-1], {"role": "user", "content": transcript}]
    reply = ""
    for text in stream_chat(history, system=SPOKEN):
        reply += text
        yield {"type": "text", "text": text}
    try:
        wav = speak(reply)
    except Exception:
        # The written answer is already on screen, so a speech failure is not fatal.
        log.exception("text to speech failed")
        return
    yield {"type": "audio", "data": base64.b64encode(wav).decode(), "mime": "audio/wav"}
