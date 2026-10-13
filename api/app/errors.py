DEFAULT = "The model request failed. Try again."


def friendly_error(exc: Exception, default: str = DEFAULT) -> str:
    """Turn a Gemini error into a short, safe message.

    The raw error is only written to the server log, never sent to the browser.
    """
    text = str(exc)
    code = getattr(exc, "code", None)
    if "API_KEY_INVALID" in text or "API key not valid" in text:
        return "The Gemini API key is not valid. Check api/.env, then restart the API."
    if code == 429:
        return "Gemini quota or rate limit reached. Wait a minute and try again."
    if code == 404:
        return "Gemini could not find that model. Check the model names in api/.env."
    if code in (401, 403):
        return (
            "Gemini rejected the request. Check that your API key can use this model."
        )
    return default
