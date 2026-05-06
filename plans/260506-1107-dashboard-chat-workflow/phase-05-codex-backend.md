# Phase 05: Codex Backend (Claude Alternative)

## Context Links

- Plan overview: [plan.md](./plan.md)
- Phase 01 (required): [phase-01-backend-mvp.md](./phase-01-backend-mvp.md) — provides `llm_bridge.py` with Claude impl + fence-parsing tool loop
- Phase 02 (required): [phase-02-frontend-chat.md](./phase-02-frontend-chat.md) — provides chat panel + `chat-api.ts`
- Phase 04 (compatible): [phase-04-guardrails.md](./phase-04-guardrails.md) — tool allowlist + confirm flow; reused unchanged
- Codex CLI: `codex-cli 0.128.0` at `~/.nvm/versions/node/v22.0.0/bin/codex` (OpenAI)
- Codex repo: https://github.com/openai/codex (verified `codex-rs/exec/src/exec_events.rs`)

## Overview

- **Priority:** P3
- **Status:** pending
- **Effort:** ~0.5d
- **Blocker:** P1 + P2 done
- **Description:** Add Codex CLI as a **drop-in alternative to Claude** so users can keep working when Claude quota runs out. Treat Codex exactly like Claude: spawn subprocess, parse JSONL stdout, use the **same** ```flowkit {...}``` fence protocol + `tool_executor`. Frontend gains a tiny model selector (Claude default, Codex fallback). No new dependencies, no schema changes.

## Use Case

> "Tôi đang chat với Claude nhưng hết gói — chuyển sang Codex để tiếp tục."

User picks Codex from a dropdown when starting a new chat session. From there everything (tool calls, confirmations, library writes, skills) works identically. Existing Claude sessions are untouched.

## Key Insights

1. **Codex is just another CLI subprocess.** Symmetric with current Claude integration. Same prompt, same fence protocol, same `tool_executor`, same multi-round loop. Only the subprocess + stdout parser differ.
2. **`codex exec --json` event schema is fully defined** in `codex-rs/exec/src/exec_events.rs`. We consume four:
   - `thread.started` { thread_id } — log only
   - `item.completed` with `item.type == "agent_message"` { text } — the whole assistant message
   - `item.completed` with `item.type == "reasoning"` { text } — optional, surfaced as `reasoning` NDJSON
   - `turn.failed` / top-level `error` — surface as `error` NDJSON
3. **No text-delta events.** Codex emits the assistant message whole at `item.completed`. We yield a single `text` NDJSON per round. UX: brief pause, then full message. Tool loop unchanged.
4. **Auth is out-of-band.** `codex login` (ChatGPT subscription default) handles auth in Codex's own keychain. Backend never touches `OPENAI_API_KEY`. Pre-flight `codex login status` at chat start; if logged out, emit a friendly error.
5. **Default Codex model = `gpt-5.3-codex`** (matches local config). Picker shows one Codex option; no need for an OpenAI sub-menu.
6. **No shell side-effects.** Tools run in our process via `tool_executor`. Spawn flags: `--sandbox read-only --ask-for-approval never --skip-git-repo-check --ephemeral --json`. Codex never executes shell.
7. **History rebuild, not `exec resume`.** Match Claude exactly — re-feed full message history into stdin each round. No thread-id persistence, no schema change.
8. **`chat_session.model` field already exists** (P1 schema, default `claude-sonnet-4-5`). No DB migration.

## Requirements

### Functional
- `LLMBackend` ABC with one abstract method (`_run_round`); shared `stream_chat` template method handles the fence loop identically for all backends.
- `ClaudeBackend` — extracted verbatim from current `llm_bridge.py`.
- `CodexBackend` — spawns `codex exec --json`; reuses `_format_history`, `_parse_tool_call`, `tool_executor.execute_tool_call`, `needs_confirmation`, `build_system_prompt()` unchanged.
- `get_backend(model: str) -> LLMBackend` factory:
  - `claude*` → `ClaudeBackend`
  - `gpt*` / `o1*` / `codex*` → `CodexBackend`
  - else → `ValueError`
- Pre-flight `_codex_logged_in()` (60s cached). If logged out: emit `error` event "Codex chưa đăng nhập — chạy `codex login` trong terminal." before spawn.
- Frontend model selector above chat input (visible only on **new** session):
  - Claude (default) — `claude-sonnet-4-5`
  - Codex (alternative) — `gpt-5.3-codex`
  - Selected value sent in `POST /api/chat` body, stored in `chat_session.model`.
- Existing sessions: model loaded read-only, picker hidden or disabled.
- Optional small label in session list: "via Codex" badge for non-default sessions.

### Non-functional
- No new Python deps
- No new npm deps
- Each new file ≤ 200 lines
- Backwards compatible: existing sessions default to `claude-sonnet-4-5`

## Architecture

```
agent/services/llm_bridge.py            ← refactored: factory shell + build_system_prompt (~80 lines)
agent/services/llm_backends/
  ├── __init__.py                       ← exports get_backend, LLMBackend
  ├── base.py                           ← LLMBackend ABC + shared helpers + template stream_chat (~110 lines)
  ├── claude_backend.py                 ← extracted from current llm_bridge.py (~190 lines)
  └── codex_backend.py                  ← codex exec --json + same fence loop (~170 lines)
```

### Shared loop in `base.py`

The fence-parsing tool loop is identical between Claude and Codex. Extract once:

```python
class LLMBackend(ABC):
    name: str  # "claude" | "codex"

    def __init__(self, model: str):
        self.model = model

    @abstractmethod
    async def _run_round(self, prompt: str, system_prompt: str) -> AsyncIterator[tuple[str, str]]:
        """Yield ('text', delta) | ('reasoning', text) | ('error', msg) | ('full', whole_text)."""

    async def stream_chat(self, messages, *, session_id, project_id, extra_system, auto_approve_mutations):
        # Body lifted verbatim from current llm_bridge.stream_chat.
        # Calls self._run_round(...) instead of the hard-coded _run_claude_round.
        ...
```

Shared module-level helpers move with it: `MAX_ROUNDS`, `_FENCE_RE`, `_format_history`, `_parse_tool_call`, `_ndjson`.

### Codex per-round subprocess

```python
# codex_backend.py — shape only
class CodexBackend(LLMBackend):
    name = "codex"

    async def _run_round(self, prompt, system_prompt):
        if not _codex_available():
            yield ("error", "codex CLI không có trên PATH")
            yield ("full", ""); return
        if not _codex_logged_in():
            yield ("error", "Codex chưa đăng nhập — chạy `codex login` trong terminal.")
            yield ("full", ""); return

        full_prompt = f"[SYSTEM]\n{system_prompt}\n\n{prompt}"

        proc = await asyncio.create_subprocess_exec(
            "codex", "exec",
            "--json",
            "--sandbox", "read-only",
            "--ask-for-approval", "never",
            "--skip-git-repo-check",
            "--ephemeral",
            "-c", f'model="{self.model}"',
            "-",                                # read prompt from stdin
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        proc.stdin.write(full_prompt.encode()); proc.stdin.close()

        full_text = ""
        while True:
            line = await proc.stdout.readline()
            if not line: break
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            etype = ev.get("type")
            item = ev.get("item") or {}
            itype = item.get("type")

            if etype == "item.completed" and itype == "agent_message":
                txt = item.get("text", "")
                if txt:
                    full_text = txt          # whole message — no token deltas
                    yield ("text", txt)
            elif etype == "item.completed" and itype == "reasoning":
                rtxt = item.get("text", "")
                if rtxt:
                    yield ("reasoning", rtxt)
            elif etype == "turn.failed":
                yield ("error", ev.get("error", {}).get("message", "codex turn failed"))
            elif etype == "error":
                yield ("error", ev.get("message", "codex error"))

        rc = await proc.wait()
        if rc != 0:
            stderr = (await proc.stderr.read()).decode("utf-8", errors="replace") if proc.stderr else ""
            yield ("error", f"codex exited rc={rc}: {stderr[-400:]}")
        yield ("full", full_text)
```

### `llm_bridge.py` after refactor

```python
# ~80 lines: keep build_system_prompt here (already wired to skill_executor + BASE_DIR);
# expose factory + back-compat stream_chat wrapper.
from agent.services.llm_backends import LLMBackend, ClaudeBackend, CodexBackend

def get_backend(model: str) -> LLMBackend:
    m = (model or "").lower()
    if m.startswith("claude"):
        return ClaudeBackend(model=model)
    if m.startswith(("gpt", "o1", "codex")):
        return CodexBackend(model=model)
    raise ValueError(f"unknown model: {model!r}")

async def stream_chat(messages, *, model="claude-sonnet-4-5", **kw):
    return get_backend(model).stream_chat(messages, **kw)
```

### Frontend model selector

```typescript
// dashboard/src/components/projects/ChatModelPicker.tsx (~60 lines)
const MODELS = [
  { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', tag: 'default' },
  { id: 'gpt-5.3-codex',     label: 'Codex (GPT-5.3)',   tag: 'alt'     },
] as const

// Visible only when starting a new session.
// Existing sessions: hide the picker; show a small "via Codex" pill in the header
// if session.model starts with gpt|o1|codex.
```

State flow:
- New session: user picks model → `POST /api/chat` body includes `model` → backend stores in `chat_session.model`.
- Existing session: picker hidden, model is whatever the session was created with.

## Related Code Files

### Files to Modify
- `agent/services/llm_bridge.py` — strip subprocess body; keep `build_system_prompt` + factory + back-compat wrapper.
- `agent/api/chat.py` — read `session.model` (default `claude-sonnet-4-5`); call `get_backend(session.model).stream_chat(...)`; on new session, persist `model` from request body.
- `dashboard/src/components/projects/ProjectChatPanel.tsx` — render `ChatModelPicker` on new-session UI; pass `model` to `streamChat`.
- `dashboard/src/components/projects/ChatSessionList.tsx` — show "via Codex" pill for non-Claude sessions.
- `dashboard/src/api/chat-api.ts` — `streamChat()` accepts `model?: string`; sent in body.
- `dashboard/src/types/index.ts` — add `model?: string` to chat request type.

### Files to Create
- `agent/services/llm_backends/__init__.py` (~10 lines)
- `agent/services/llm_backends/base.py` (~110 lines — ABC + shared helpers + template `stream_chat`)
- `agent/services/llm_backends/claude_backend.py` (~190 lines — extracted from current `llm_bridge.py`)
- `agent/services/llm_backends/codex_backend.py` (~170 lines — new)
- `dashboard/src/components/projects/ChatModelPicker.tsx` (~60 lines)

### Files NOT to Touch
- `agent/db/schema.py` / `agent/db/crud.py` — `chat_session.model` already exists; no migration.
- `agent/services/skill_executor.py` — system prompt source unchanged.
- `agent/services/tool_executor.py` — fence dispatch unchanged.

## Implementation Steps

1. **Sanity-check Codex locally** (~5 min)
   - `codex login status` — must show "Logged in"
   - `echo "say hi" | codex exec --json --skip-git-repo-check --ephemeral --sandbox read-only -` — confirm event types match `exec_events.rs`

2. **Create `llm_backends/base.py`** (~110 lines)
   - `LLMBackend` ABC with abstract `_run_round`
   - Concrete `stream_chat` template (lifted verbatim from current `llm_bridge.stream_chat`)
   - Move `_format_history`, `_parse_tool_call`, `_ndjson`, `MAX_ROUNDS`, `_FENCE_RE` here

3. **Extract `ClaudeBackend`** (~190 lines)
   - Move current `_run_claude_round` body into `ClaudeBackend._run_round`
   - Constructor accepts `model` (passed through if non-default; verify Claude CLI override semantics)

4. **Implement `CodexBackend`** (~170 lines)
   - `_codex_available()` and `_codex_logged_in()` helpers (60s cache for the latter)
   - `_run_round` per shape above
   - Don't fail on harmless stderr noise when rc==0; log warning only

5. **Refactor `llm_bridge.py` to factory shell** (~80 lines)
   - Keep `build_system_prompt` here (skill_executor wiring stays)
   - Add `get_backend()` and back-compat `stream_chat(model=...)` wrapper

6. **Update `agent/api/chat.py`**
   - Read `session.model` (fallback `claude-sonnet-4-5` on NULL)
   - On POST new session: persist `model` from request body
   - Use factory; on `ValueError`, yield friendly error event ("model không được hỗ trợ")

7. **Frontend types** (`types/index.ts`)
   - Add `model?: string` to chat request type

8. **`ChatModelPicker.tsx`** (~60 lines)
   - 2-option `<select>`: Claude default, Codex alternative
   - Visible only when `sessionId` is `null` (new chat)

9. **`ProjectChatPanel.tsx`** updates
   - State: `selectedModel` (default `claude-sonnet-4-5`)
   - Render `ChatModelPicker` only on new-session view
   - On send (new session): pass `model` to `chat-api.streamChat()`
   - On existing session: read model from session metadata for badge only

10. **`ChatSessionList.tsx`** updates
    - "via Codex" pill on sessions where `model` startsWith `gpt|o1|codex`

11. **`chat-api.ts`** updates
    - `streamChat()` accepts `model?: string`; included in `POST /api/chat` body

12. **Build + integration test**
    - `pytest tests/` — Claude path regression
    - Manual: new chat with Claude → unchanged
    - Manual: new chat with Codex → assistant message lands as one chunk; tool call (e.g. "list my projects") triggers fence → tool_executor → result fed back → loop continues
    - Manual: existing Claude session reopened → no picker, no regression
    - Manual: `codex logout` then send → friendly error event, no crash; `codex login` recovers without restarting agent

13. **Documentation**
    - `CLAUDE.md`: one-liner under "Common commands": "Dashboard chat fallback to Codex requires `codex login` once; pinned to codex-cli 0.128.0"
    - `README.md`: "Khi hết gói Claude, chọn Codex từ model picker để tiếp tục chat."

## Todo List

- [ ] Verify `codex exec --json` output against `exec_events.rs`
- [ ] Create `agent/services/llm_backends/base.py`
- [ ] Extract Claude logic into `claude_backend.py`
- [ ] Implement `codex_backend.py`
- [ ] Refactor `llm_bridge.py` to factory shell
- [ ] Update `chat.py` to use factory + persist `model` on new session
- [ ] Add `model?` field to chat request type
- [ ] Create `ChatModelPicker.tsx` (2-option select)
- [ ] Wire model state into `ProjectChatPanel.tsx`
- [ ] Add "via Codex" pill to `ChatSessionList.tsx`
- [ ] Update `chat-api.ts` to send `model`
- [ ] `pytest` passes
- [ ] `npm run build` exits 0
- [ ] Manual test Claude path
- [ ] Manual test Codex path (logged in)
- [ ] Manual test Codex fallback (logged out → friendly error)
- [ ] Update CLAUDE.md / README

## Success Criteria

- New chat with Claude → streams as before (regression).
- New chat with Codex → assistant message arrives as one chunk; fence-tool calls execute; multi-round loop terminates; behaviour identical to Claude path otherwise.
- `chat_session.model` correctly persisted; sessions created before P5 default to `claude-sonnet-4-5`.
- Existing Claude sessions reopen without picker, no regression.
- `codex` not on `$PATH` or not logged in → graceful error event, no 500.
- `pytest` all green; `npm run build` no errors.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| User chưa `codex login` | Medium | High | Pre-flight `codex login status` (60s cache); friendly error before spawn |
| Codex emits no text deltas → UI feels stalled | High | Low | Frontend already tolerates single-chunk `text`; optional "Codex đang nghĩ…" placeholder on `turn.started` |
| Fence-protocol obedience worse on Codex than Claude | Medium | Medium | Same prompt works for Codex (tool-use trained). If miss-rate too high, add one example tool call to system prompt for `codex*` models only |
| `codex exec` rc≠0 with partial output | Low | Low | Yield captured text + tail of stderr in `error`; loop short-circuits if no `agent_message` |
| Codex CLI version drift (event schema) | Low | Medium | Pin tested version (`codex-cli 0.128.0`) in CLAUDE.md; warn at startup if mismatch |
| Mid-conversation model switch breaks coherence | High (if allowed) | Medium | Picker visible only on new session; existing sessions are locked |
| `--ask-for-approval never` flag drift | Low | Low | Verified in 0.128.0; fallback `--dangerously-bypass-approvals-and-sandbox` if rejected (combined with `--sandbox read-only`) |
| Codex injects shell instead of fence | Medium | Medium | `--sandbox read-only` blocks shell side-effects; fence parser ignores non-fence text; system prompt forbids shell |

## Security Considerations

- `--sandbox read-only` blocks shell side-effects from Codex.
- `OPENAI_API_KEY` (if `codex login --with-api-key` was used) lives in Codex's keychain; FlowKit never reads it.
- Tool allowlist (P4) applies regardless of backend.
- Audit log unchanged for now; add `model` column in a follow-up if needed.

## Next Steps

- Future: GeminiBackend (~0.5d) — same drop-in alternative pattern, gemini CLI installed locally.
- Future: per-project default model preference.
- Future: auto-failover ("Claude báo quota → tự đề xuất Codex cho session mới").
- Future: token-usage panel — `turn.completed.usage` carries Codex token counts.
