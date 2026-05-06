# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Flow Kit = Python agent (FastAPI + SQLite + WebSocket) + Chrome MV3 extension that bridges to Google Flow (`labs.google/fx/tools/flow`). The agent never talks to Google directly — every Flow API call goes Python → WebSocket (`:9222`) → extension → `aisandbox-pa.googleapis.com`. The extension captures the bearer token, solves reCAPTCHA, and proxies requests. SQLite persists projects/videos/scenes/characters/requests; a background worker drains the request queue.

Detailed architecture, DB schema, request types, error matrix, and full API reference live in `README.md` and `ARCHITECTURE.md` — read them before non-trivial changes. Don't duplicate that content here.

## Two modes you operate in

1. **Pipeline user mode** (most common). User says `/fk-*` — drive the running agent via REST. Skill files in `skills/fk-*.md` contain the workflow rules; obey them. Pre-flight every workflow with `curl -s http://127.0.0.1:8100/health` (must show `extension_connected: true`). On any pipeline error (request `FAILED`, stuck `PROCESSING`, `extension_connected: false`, HTTP 4xx/5xx, `UNSAFE_GENERATION` / `not found` / `CAPTCHA` / `NO_FLOW_KEY`), run `/fk-doctor` before guessing a fix.
2. **Codebase dev mode** — modifying agent/extension/skills/dashboard. The rest of this file is for that mode.

## Common commands

```bash
# Setup (one-shot — installs deps, venv, ffmpeg check, statusline)
./setup.sh

# Run agent (REST :8100, WS :9222 for extension)
source venv/bin/activate
python -m agent.main

# Tests (pytest + asyncio_mode=auto)
pytest                            # all
pytest tests/unit/test_processor.py        # one file
pytest tests/unit/test_processor.py::test_name -v   # one test
pytest -k "uuid"                  # by keyword

# Regenerate AGENTS.md / GEMINI.md / .claude/commands/ from skills/
python setup.py --tool all        # or --tool claude|gemini|codex

# Dashboard (React 19 + Vite + Tailwind v4)
cd dashboard && npm run dev       # vite dev
cd dashboard && npm run build     # tsc -b && vite build
cd dashboard && npm run lint      # eslint
```

No top-level lint command for Python — keep imports clean and run tests. There is no Makefile.

## Architecture cheatsheet (orientation only — see ARCHITECTURE.md for depth)

```
agent/
  main.py             FastAPI app + WS server (extension connects to ws://127.0.0.1:9222)
  config.py           Env-overridable constants; loads models.json
  models.json         video/upscale/image model name → Flow internal ID
  api/                REST routers: projects, videos, scenes, characters, requests,
                      flow, reviews, tts, materials, music, models, active_project
  db/                 aiosqlite schema + CRUD with column whitelisting
  models/             Pydantic request/response (API layer)
  sdk/                Domain SDK — see "SDK vs Worker" below
  services/           flow_client (WS bridge), tts, post_process (ffmpeg),
                      scene_chain, suno, video_reviewer, event_bus, headers
  worker/processor.py Drains request queue. Thin dispatcher → OperationService.
                      Rate-limits: 5 concurrent + 10s gap. Routes failures by
                      error_message string (not just HTTP status).
extension/            Chrome MV3 — token capture, reCAPTCHA, request proxy
skills/fk-*.md        Source of truth for AI-agent workflows
dashboard/            React 19 + Vite + Tailwind v4 status UI
tools/review_*        Standalone scene-review board (HTML + tiny server)
youtube/              OAuth + upload (gitignored channel data)
```

## SDK vs Worker — important pattern

`agent/sdk/` provides type-safe domain models (`Scene`, `Character`, `Project`, `Video`) with **two execution modes** for the same operation:

- **Queue mode** (`scene.generate_image(...)`) — creates a PENDING `request` row, returns immediately. The background worker picks it up.
- **Direct mode** (`scene.execute_generate_image(...)`) — calls `OperationService` synchronously, returns `GenerationResult`.

Both paths funnel through `agent/sdk/services/result_handler.py` (`parse_result`, `apply_scene_result`, `apply_character_result`) so DB updates and cascade rules stay identical. **When adding a new generation op, wire both queue + direct through `OperationService` and the shared result handler — never duplicate the parse/persist logic in the worker.**

Cascade rules: regen image → clears downstream video + upscale; regen video → clears upscale; upscale → no cascade. Implemented in `result_handler`, exercised by `tests/unit/test_result_handler.py`.

## Worker error routing

`agent/worker/processor.py::_handle_failure` decides retry vs terminal by **substring match on `error_message`**, because Flow returns many distinct failures under HTTP 400 with `details.reason`. Patterns the worker recognises (full table in README.md → "Error Handling"):

- `not found` → auto re-upload media, re-queue PENDING (entity TTL ~1h)
- `reconnected` / `disconnected` / `extension_switched` → re-queue PENDING, don't bump `retry_count`
- `captcha` → retry up to 10× without counting toward `MAX_RETRIES`
- `UNSAFE_GENERATION`, `USER_QUOTA_REACHED`, `MODEL_ACCESS_DENIED` → terminal FAIL
- default → exp backoff `2^retry * 10s` capped 300s, max 5 retries

When touching this function: keep the substring routing — do not switch to status-code-only logic, you'll regress recovery for entity-TTL and captcha cases.

## Auto-generated files — DO NOT hand-edit

`AGENTS.md`, `GEMINI.md`, `.claude/commands/fk:*.md`, `.gemini/commands/fk/*.md` are all generated from `skills/fk-*.md` by `setup.py`. They're in `.gitignore`. After changing a skill, run `python setup.py sync` to regenerate. Edit the skill, never the generated artefact.

## Conventions worth keeping

- **`media_id` is always UUID** (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`). Never `CAMS...` base64. If a Flow response gives `CAMS...`, extract the UUID from `fifeUrl`'s `/image/{UUID}?...` segment (logic lives in `agent/worker/_parsing.py` and `result_handler`).
- **No throwaway loop scripts** — when many similar requests are needed, use `POST /api/requests/batch` and poll `GET /api/requests/batch-status`. The worker enforces concurrency + cooldown automatically.
- **Scene prompts = action only**, never appearance. Reference images carry visual identity via `imageInputs`/`character_names`.
- **Tests use `asyncio_mode = auto`** (`pytest.ini`) — `async def test_*` works without `@pytest.mark.asyncio`. Fixtures in `tests/conftest.py` cover sample Flow responses (success, CAMS-only, errors) and DB rows; reuse them.
- **DB schema changes** go in `agent/db/schema.py`; CRUD column whitelists in `agent/db/crud.py` must be updated in lockstep — leaving CRUD out silently drops fields.
- **Pydantic enums** for status/orientation/chain_type/entity_type live in `agent/models/enums.py` and the SDK mirror in `agent/sdk/models/enums.py`. Mismatch between them = serialization bugs.

## Key configuration

Defaults in `agent/config.py`, all env-overridable:

| Var | Default | Notes |
|---|---|---|
| `API_PORT` / `WS_PORT` | `8100` / `9222` | REST + extension WS |
| `MAX_CONCURRENT_REQUESTS` | `5` | Worker semaphore |
| `API_COOLDOWN` | `10` | Min seconds between Flow calls |
| `MAX_RETRIES` | `5` | Per-request, excludes captcha & WS-bounce |
| `VIDEO_POLL_TIMEOUT` | `420` | Async video op give-up |
| `STALE_PROCESSING_TIMEOUT` | `600` | Reset stuck PROCESSING rows |
| `ANTHROPIC_API_KEY` | — | Needed for `/fk-review-video` (Claude Vision) |
| `SUNO_API_KEY` | — or from `youtube/channels/*/channel_rules.json` | Music gen |
| `TTS_DEVICE` | `cpu` | MPS produces gibberish — keep CPU |

## What lives where for changes

- New REST endpoint → router in `agent/api/`, register in `agent/main.py`, Pydantic models in `agent/models/`.
- New request type → add to `request.type` CHECK in `agent/db/schema.py`, `_API_CALL_TYPES` + `_TYPE_PRIORITY` in `agent/worker/processor.py`, `OperationService` (`agent/sdk/services/operations.py`), and a domain method on the relevant SDK model.
- New AI-agent workflow → write `skills/fk-<name>.md`, then `python setup.py sync`. Don't add it to README skill tables manually if you can avoid it; tables are hand-maintained.
- Dashboard changes → `dashboard/src/` (React 19, react-router-dom v7, Tailwind v4 via `@tailwindcss/vite`).

## Pre-commit guard rails

- Run `pytest` before pushing changes that touch `agent/`. Don't disable failing tests.
- Don't commit `flow_agent.db*`, `output/`, `youtube/channels/*/token.json` (already gitignored).
- Don't commit hard-coded credentials. The `GOOGLE_API_KEY` / `RECAPTCHA_SITE_KEY` defaults in `config.py` are public Flow constants, not secrets — leave them unless rotating.
- Conventional commit style (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`); no AI references in messages.
