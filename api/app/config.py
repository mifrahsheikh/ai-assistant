from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    gemini_api_key: str
    gemini_model: str = "gemini-3.5-flash-lite"
    gemini_tts_model: str = "gemini-3.8-flash-lite-tts"
    gemini_tts_voice: str = "Kore"
    file_search_store_name: str = ""
    allowed_origin: str = "http://localhost:3000"


@lru_cache
def get_settings() -> Settings:
    return Settings()
