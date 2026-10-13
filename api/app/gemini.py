from functools import lru_cache

from google import genai
from google.genai import types

from .config import get_settings

# This app never uses function calling, so switch the SDK's AFC feature off.
NO_AFC = types.AutomaticFunctionCallingConfig(disable=True)


@lru_cache
def get_client() -> genai.Client:
    return genai.Client(api_key=get_settings().gemini_api_key)
