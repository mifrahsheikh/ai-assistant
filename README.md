# AI Assistant

A full-stack AI assistant with four skills, built on Google Gemini:

| Skill | What it does |
| --- | --- |
| Chat | Streams text answers |
| Image | Upload a photo and ask about it |
| Voice | Record a question, read the transcript, hear the answer |
| File | Upload a document, then ask questions with citations (Gemini File Search, managed RAG) |

```text
Browser (Next.js) -> FastAPI -> Agent (router) -> Chat | Image | Voice | File -> Gemini API
```

The Gemini key lives only in `api/.env`. The browser never sees it.

## Run it

You need Python 3.13+, [uv](https://docs.astral.sh/uv/), Node.js 20.9+ and Chrome.

1. **Get a key.** Create one at <https://aistudio.google.com/apikey>, then open `api/.env` and replace `PASTE_YOUR_KEY_HERE`. Never commit this file.
2. **Start the API** (terminal 1):

   ```bash
   cd api
   uv sync
   uv run uvicorn app.main:app --reload --reload-dir app
   ```

   `--reload-dir app` stops the server restarting itself whenever a library file in `.venv` changes. The key in `.env` is read once at start-up, so stop the server (Ctrl+C) and start it again after you edit that file.

3. **Start the web app** (terminal 2):

   ```bash
   cd web
   npm install
   npm run dev
   ```

4. Open <http://localhost:3000>.

## Try each skill

- **Chat:** type a question and press Send.
- **Image:** press Image, pick a photo, ask "What is in this picture?".
- **Voice:** press Record, ask something, press Stop. Allow the microphone when Chrome asks.
- **File:** press File, pick a PDF (up to 15 MB), press Send, then ask a question only that file can answer. The reply lists its sources.

Each reply shows which skill the agent chose.

## Checks

```bash
cd api && uv run ruff check . && uv run pytest
cd web && npm run lint && npm run build
```

The tests use fake Gemini responses, so they need no key and no network.

## If something goes wrong

| Problem | Fix |
| --- | --- |
| "The Gemini API key is not valid" | `api/.env` still has the placeholder, or the key was copied wrongly. Fix it, save, then restart the API. To check without showing the key, run `uv run python -c "from app.config import get_settings as g; k=g().gemini_api_key; print(len(k), k[:4])"` in `api`. A first part of `PAST` means the placeholder is still there. |
| "The model request failed" | Look at the API terminal. It prints the real cause, such as a network problem. |
| The terminal keeps printing "WatchFiles detected changes" | Start the API with `--reload-dir app`, as shown above. |
| Unknown model name | Model names change. Set `GEMINI_MODEL` or `GEMINI_TTS_MODEL` in `api/.env` to a current name from <https://ai.google.dev/gemini-api/docs/models>. |
| Microphone does nothing | Use Chrome on `localhost` or HTTPS, and allow the microphone. |
| No spoken reply | The written answer still appears. The API terminal shows why speech failed. |
| File not accepted | Supported: PDF, DOCX, XLSX, PPTX, TXT, MD, CSV, JSON, HTML, up to 15 MB. |
| Port already in use | Stop the old server, or start on another port and set `API_URL` in `web/.env.local`. |

## Project layout

```text
api/app/main.py       FastAPI app and the /api/agent stream
api/app/agent.py      picks the skill for each request
api/app/skills/       chat.py, image.py, voice.py, file.py
api/app/config.py     settings read from .env
api/tests/            tests with fake Gemini responses
web/app/page.tsx      the whole chat UI
web/next.config.ts    forwards /api to FastAPI
```
