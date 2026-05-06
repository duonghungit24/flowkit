# Phase 01: Backend MVP

## Context Links

- Plan overview: [plan.md](./plan.md)
- Source pattern: `zach94-fullstack/agent-flowkit` — `agent/api/chat.py`, `agent/api/tool_executor.py`
- Local Claude CLI pattern: `agent/services/video_reviewer.py:297-321` (`_analyze_cli`)
- DB schema: `agent/db/schema.py:164-305` (migration pattern)
- CRUD column whitelist: `agent/db/crud.py:19-34`
- Router registration: `agent/main.py:121-132`

## Overview

- **Priority:** P1 (required before frontend)
- **Status:** done
- **Effort:** ~1 day
- **Description:** New FastAPI routers for chat + tool execution + skills. Claude CLI subprocess as LLM. New DB tables for chat persistence.

## Key Insights

1. **Claude CLI subprocess pattern** (`video_reviewer.py:311-321`): `asyncio.create_subprocess_exec("claude", "-p", prompt, "--allowedTools", "Read", "--output-format", "text", ...)`. For streaming JSON we switch to `--output-format stream-json` and read stdout line-by-line.
2. **Tool loop architecture**: Source's `run_tool_loop_stream` uses OpenAI client. We replace the LLM call with Claude CLI subprocess in `--print` mode with tool definitions. Claude CLI supports `--tools` JSON flag for MCP-style tool defs when using `claude --print`.
3. **Single generic tool**: `flowkit_api(method, path, body)` — LLM calls back to `http://127.0.0.1:8100` via httpx. No per-endpoint wrappers needed.
4. **Skill intercept**: regex `^/fk-[\w-]+` at start of user message → read skill `.md` file directly → inject as system context or run via subprocess. Saves LLM tokens for known workflows.
5. **DB migration pattern**: `init_db()` in `schema.py` uses `ALTER TABLE IF NOT EXISTS column` pattern. New tables added via `CREATE TABLE IF NOT EXISTS` in SCHEMA string + `_db_lock` in CRUD.
6. **CRUD lockstep rule** (CLAUDE.md): every new table needs entries in both `_VALID_TABLES` and `_COLUMNS` in `crud.py`, or silent column drops occur.
7. **System prompt cache**: `_system_prompt_cache` module-level var. Reads `CLAUDE.md` + `AGENTS.md` + skill list once per process. Invalidated when skills change.
8. **Claude CLI streaming**: `claude --print --output-format stream-json` outputs one JSON object per line: `{"type": "text", "text": "..."}` or `{"type": "tool_use", ...}` or `{"type": "tool_result", ...}`. We translate these to our NDJSON format.

## Requirements

### Functional
- `POST /api/chat` — accept `{messages, project_id, session_id?, model?}`, return NDJSON stream
- `GET /api/chat/sessions?project_id=X` — list sessions for project
- `GET /api/chat/sessions/{sid}` — full history (messages)
- `DELETE /api/chat/sessions/{sid}` — delete session + messages (CASCADE)
- `GET /api/library-skills` — scan `skills/` dir, return `[{name, usage, description, group}]`
- Agentic loop: max 15 rounds, single `flowkit_api` tool
- Skill regex intercept: `/fk-*` prefix → execute skill directly
- Persist user + assistant messages to `chat_message` table when `project_id` present
- Auto-create `chat_session` when `session_id` not provided

### Non-functional
- NDJSON events: `text`, `tool_call`, `tool_result`, `error`, `done`
- No new Python packages beyond what's in existing venv (`httpx`, `aiosqlite` already present)
- System prompt cached in process (not per-request file reads)
- File size: each new file ≤ 200 lines (split as needed)

## Architecture

```
agent/api/chat.py              ← FastAPI router, POST /api/chat + session endpoints
agent/api/skills.py            ← GET /api/library-skills
agent/services/llm_bridge.py   ← Claude CLI subprocess wrapper, NDJSON streaming
agent/services/skill_executor.py ← detect_skill_command(), execute_skill(), list_skills()
agent/services/tool_executor.py  ← execute_tool_call(), tool allowlist check
agent/db/schema.py             ← ADD: chat_session + chat_message + tool_call_audit tables
agent/db/crud.py               ← ADD: CRUD for chat tables + column whitelists
agent/main.py                  ← ADD: import + include_router for chat + skills routers
```

### NDJSON Event Format

```jsonc
{"type": "text", "delta": "hello"}              // streaming text token
{"type": "tool_call", "id": "tc_1", "name": "flowkit_api", "args": {"method":"GET","path":"/api/projects"}}
{"type": "tool_result", "id": "tc_1", "content": "{\"projects\": [...]}"}
{"type": "error", "content": "..."}
{"type": "done", "session_id": "uuid"}
```

### DB Schema Additions

```sql
-- chat_session: one per conversation thread, scoped to a project
CREATE TABLE IF NOT EXISTS chat_session (
    id          TEXT PRIMARY KEY,
    project_id  TEXT REFERENCES project(id) ON DELETE CASCADE,
    title       TEXT NOT NULL DEFAULT 'New Chat',
    model       TEXT NOT NULL DEFAULT 'claude-sonnet-4-5',
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- chat_message: individual messages in a session
CREATE TABLE IF NOT EXISTS chat_message (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL REFERENCES chat_session(id) ON DELETE CASCADE,
    project_id  TEXT REFERENCES project(id) ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK(role IN ('user','assistant','tool')),
    content     TEXT NOT NULL,
    tool_calls  TEXT,   -- JSON array of tool call objects (for assistant messages)
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- tool_call_audit: security log for all tool executions (P4, added in Phase 01 schema)
CREATE TABLE IF NOT EXISTS tool_call_audit (
    id           TEXT PRIMARY KEY,
    session_id   TEXT REFERENCES chat_session(id) ON DELETE CASCADE,
    message_id   TEXT,
    method       TEXT NOT NULL,
    path         TEXT NOT NULL,
    body_summary TEXT,
    status       TEXT NOT NULL CHECK(status IN ('approved','rejected','auto')),
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
```

### LLM Bridge Design (Claude CLI)

`llm_bridge.py` wraps `asyncio.create_subprocess_exec`:

```
claude --print \
  --output-format stream-json \
  --system "<system_prompt>" \
  --tools '[{"name":"flowkit_api","description":"...","input_schema":{...}}]' \
  --allowedTools flowkit_api \
  -p "<last user message>"
```

**Problem**: Claude CLI `--print` mode is single-turn (prompt → response). For multi-turn with tool loop we must manage the conversation externally:

- Round 1: send messages as a formatted prompt string
- If Claude returns tool_use → execute → append result to messages → Round 2
- Repeat until Claude returns only text or max_rounds reached

**Alternative**: Use `claude --input-format json` with a full messages array piped via stdin. This is the correct approach for multi-turn.

```python
proc = await asyncio.create_subprocess_exec(
    "claude", "--print",
    "--output-format", "stream-json",
    "--input-format", "json",          # read messages JSON from stdin
    "--allowedTools", "flowkit_api",
    stdin=asyncio.subprocess.PIPE,
    stdout=asyncio.subprocess.PIPE,
    stderr=asyncio.subprocess.PIPE,
)
payload = json.dumps({"system": system_prompt, "messages": messages, "tools": TOOL_DEFS})
proc.stdin.write(payload.encode())
proc.stdin.close()
# read stdout line-by-line, translate stream-json → our NDJSON
```

Claude CLI handles the tool loop internally when `--allowedTools` is provided — it will call tools and loop until done, streaming each step. **No manual loop needed.** This simplifies `llm_bridge.py` dramatically vs. the source's 9Router approach.

### Skill Executor Design

```python
# skill_executor.py
import re
from pathlib import Path

SKILLS_DIR = Path(__file__).parent.parent.parent / "skills"
_SKILL_RE = re.compile(r'^/fk-([\w-]+)\s*(.*)', re.IGNORECASE)

def detect_skill_command(text: str) -> tuple[str, str] | None:
    """Return (skill_name, args) if text starts with /fk-<name>, else None."""
    m = _SKILL_RE.match(text.strip())
    return (m.group(1), m.group(2).strip()) if m else None

def list_skills() -> list[dict]:
    """Scan skills/ dir, return [{name, usage, description, group}]."""
    ...

async def execute_skill(name: str, args: str) -> str:
    """Read skill .md, inject as system context, run via llm_bridge."""
    ...
```

## Related Code Files

### Files to Modify
- `agent/db/schema.py` — add SCHEMA tables + migration blocks for new tables
- `agent/db/crud.py` — add `_VALID_TABLES` entries, `_COLUMNS` entries, CRUD functions for chat
- `agent/main.py` — import and `include_router` for chat + skills routers

### Files to Create
- `agent/api/chat.py` — chat endpoint + session CRUD endpoints
- `agent/api/skills.py` — library-skills endpoint
- `agent/services/llm_bridge.py` — Claude CLI subprocess wrapper
- `agent/services/skill_executor.py` — skill detection + execution
- `agent/services/tool_executor.py` — `execute_tool_call()` with allowlist

## Implementation Steps

1. **DB schema** (`agent/db/schema.py`)
   - Append `chat_session`, `chat_message`, `tool_call_audit` to SCHEMA string (before closing `"""`)
   - Add indexes: `idx_chat_message_session ON chat_message(session_id)`, `idx_chat_session_project ON chat_session(project_id)`
   - Add migration block in `init_db()`: check `sqlite_master` for each new table → create if missing (pattern: lines 298-304)

2. **CRUD** (`agent/db/crud.py`)
   - Add `"chat_session"`, `"chat_message"`, `"tool_call_audit"` to `_VALID_TABLES` (line 11)
   - Add column dicts in `_COLUMNS` for each table
   - Add functions: `create_chat_session`, `list_chat_sessions`, `get_chat_session`, `delete_chat_session`, `create_chat_message`, `list_chat_messages`, `create_tool_audit`

3. **`agent/services/tool_executor.py`** (new, ≤150 lines)
   - Define `FLOWKIT_TOOLS` list (tool schema for Claude CLI `--tools` flag)
   - `execute_tool_call(method, path, body, session_id)` — httpx call, `_clean_refs` workaround
   - Allowlist check: `GET`/`POST` → auto; `PATCH`/`DELETE` → raise `ConfirmationRequired` exception (used by P4)
   - Write audit entry via `create_tool_audit` on each call

4. **`agent/services/skill_executor.py`** (new, ≤150 lines)
   - `detect_skill_command(text)` — regex match
   - `list_skills()` — scan `skills/fk-*.md`, parse first 5 lines for metadata (`# Title`, `usage:`, `description:`)
   - `execute_skill(name, args)` — read `.md`, return content as string (LLM will receive it as system injection)

5. **`agent/services/llm_bridge.py`** (new, ≤180 lines)
   - `build_system_prompt()` — load `CLAUDE.md` + `AGENTS.md` + skill list, cache in `_system_prompt_cache`
   - `stream_chat(messages, system_prompt, tools, session_id)` — async generator yielding NDJSON lines
   - Spawn `claude --print --output-format stream-json --input-format json`
   - Translate Claude stream-json events → our NDJSON format:
     - `{"type":"text","text":"..."}` → `{"type":"text","delta":"..."}`
     - `{"type":"tool_use","id":"...","name":"...","input":{...}}` → execute tool → `{"type":"tool_call",...}` + `{"type":"tool_result",...}`
   - Yield `{"type":"done","session_id":"..."}` at end

6. **`agent/api/skills.py`** (new, ≤40 lines)
   - `GET /api/library-skills` → call `list_skills()` → return JSON list

7. **`agent/api/chat.py`** (new, ≤180 lines)
   - `POST /api/chat` — validate body, persist user message, detect skill, build system prompt, call `stream_chat`, stream response, persist assistant message
   - `GET /api/chat/sessions` — query param `project_id`, call `list_chat_sessions`
   - `GET /api/chat/sessions/{sid}` — return session + messages
   - `DELETE /api/chat/sessions/{sid}` — delete (CASCADE handles messages)

8. **`agent/main.py`** (modify)
   - Add imports: `from agent.api.chat import router as chat_router` + `from agent.api.skills import router as skills_router`
   - Add: `app.include_router(chat_router, prefix="/api")` + `app.include_router(skills_router, prefix="/api")` after line 132

9. **Smoke test** — curl sequence:
   ```bash
   # Start agent
   source venv/bin/activate && python -m agent.main &
   # Test skills endpoint
   curl http://127.0.0.1:8100/api/library-skills
   # Test chat (2-step task)
   curl -N -X POST http://127.0.0.1:8100/api/chat \
     -H "Content-Type: application/json" \
     -d '{"messages":[{"role":"user","content":"list my projects then show details of the first one"}],"project_id":null}'
   # Verify NDJSON stream: should see text + tool_call + tool_result + done events
   ```

## Todo List

- [x] Add `chat_session`, `chat_message`, `tool_call_audit` tables to `schema.py` SCHEMA
- [x] Add migration blocks in `init_db()` for new tables (idempotent via `CREATE TABLE IF NOT EXISTS` in `executescript(SCHEMA)`)
- [x] Update `_VALID_TABLES` in `crud.py`
- [x] Add `_COLUMNS` entries for all 3 new tables
- [x] Implement chat CRUD functions in `crud.py`
- [x] Create `agent/services/tool_executor.py` with `execute_tool_call` + `FLOWKIT_TOOLS`
- [x] Create `agent/services/skill_executor.py` with detect/list/execute
- [x] Create `agent/services/llm_bridge.py` with `stream_chat` + system prompt builder
- [x] Create `agent/api/skills.py`
- [x] Create `agent/api/chat.py` with all 4 endpoints
- [x] Register routers in `agent/main.py`
- [x] Run `pytest tests/` — ensure no regressions (3 fail/9 err pre-existing, confirmed via `git stash`)
- [x] Smoke test (in-process via FastAPI TestClient): skills list (34 skills) + streaming chat (NDJSON) + session CRUD + tool guardrails (ConfirmationRequired + audit log)

## Success Criteria

- `GET /api/library-skills` returns ≥5 skill objects with `name`, `usage`, `description` fields
- `POST /api/chat` with 2-step task ("list projects then show first") returns NDJSON stream with at least 1 `tool_call` event and 1 `tool_result` event followed by `done`
- `GET /api/chat/sessions?project_id=X` returns session created by prior chat
- All existing `pytest` tests pass

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Claude CLI `--input-format json` not available in older Claude Code versions | Medium | High | Fallback: format messages as a single prompt string; test with `claude --version` in startup check |
| `claude` not on `$PATH` at process start | Low | High | Check in `llm_bridge.py` startup; return `{"type":"error","content":"claude CLI not found"}` gracefully |
| Tool loop exceeds 15 rounds for complex requests | Low | Medium | Hard cap at 15; yield `error` event with "max rounds reached" |
| `AGENTS.md` missing (gitignored, generated by setup.py) | Medium | Low | Gracefully skip if absent; log warning; system prompt still works with CLAUDE.md + skills |
| SQLite migration fails midway | Very Low | High | Each migration is idempotent (IF NOT EXISTS); restart recovers |

## Security Considerations

- Tool calls go only to `http://127.0.0.1:8100` — loopback only, no external network
- `_clean_refs` prevents `$ref` injection in JSON passed to LLM
- All httpx calls have explicit timeout (60s)
- `PATCH`/`DELETE` allowlist check in `tool_executor.py` — raises `ConfirmationRequired` (P4 hook point)
- No API keys stored; Claude CLI uses existing subscription auth

## Implementation Notes (post-build)

- **Claude CLI deviation**: plan called for `--input-format json` + custom `--tools` JSON, but Claude Code 2.1.131 only supports `--input-format text|stream-json` and `--tools` filters built-in tool names only — custom tools require MCP. Implementation uses **manual parse-and-loop**: system prompt instructs the model to emit a fenced `​```flowkit {...}​```` block; `llm_bridge._parse_tool_call` extracts it; `tool_executor.execute_tool_call` runs it; result is appended to history and the loop continues up to `MAX_ROUNDS=15`. Streams partial text deltas via `--output-format stream-json --include-partial-messages`. P4 can switch to a real MCP server later without changing the public NDJSON contract.
- **Migration block**: dropped — `executescript(SCHEMA)` already runs `CREATE TABLE IF NOT EXISTS` for all three new tables idempotently. Only legacy `ALTER TABLE … ADD COLUMN` migrations need explicit guard blocks.
- **Pytest baseline**: 3 failing + 9 erroring tests in `test_processor.py` and `test_result_handler.py` are pre-existing (confirmed via `git stash` before our changes); not introduced here.

## Next Steps

- P2 (frontend) can begin once `/api/chat` endpoint is confirmed working via curl
- P4 (guardrails) depends on `ConfirmationRequired` exception defined in `tool_executor.py` (stub it here, implement in P4)
