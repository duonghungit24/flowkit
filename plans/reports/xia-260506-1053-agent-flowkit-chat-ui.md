# Feature Comparison: AI Chat UI on Dashboard

## Source: zach94-fullstack/agent-flowkit (master @ a3eba40 — Initial commit, 2026-05-04)
## Local Project: flowkit (HEAD 6e017bf — main)

> Source = fork/clone of upstream `tuannguyenhoangit-droid/google-flow-agent`. README byte-identical, badges still point to original. Single commit "Initial commit for public release". Net diff vs current local = **chat UI + library page + skill catalog API + agentic tool-calling loop**.

---

## Source Manifest

- Repo: `zach94-fullstack/agent-flowkit`
- Branch: `master`
- Commit SHA: `a3eba40`
- License: MIT
- Stars: 0 | Created: 2 days ago | Updated: same day
- Languages: Python 548K · TS 218K · JS 52K · HTML 22K · Shell 13K
- Scope analyzed: `agent/api/`, `agent/services/`, `agent/db/schema.py`, `dashboard/src/`, `skills/`

## Source Anatomy (delta vs upstream)

### Backend additions
| File | Role |
|------|------|
| `agent/api/chat.py` | `POST /chat` — LLM chat endpoint, intercepts `/fk:*`, NDJSON streaming |
| `agent/api/tool_executor.py` | Agentic tool-calling loop, single `flowkit_api(method,path,body)` tool, max 15 rounds, Gemini `$ref` workaround |
| `agent/api/skills.py` | `GET /library-skills` — scan `skills/` dir, parse metadata, return groups |
| `agent/services/skill_executor.py` | `detect_skill_command`, `execute_skill`, `list_skills` |
| `agent/db/schema.py` | New tables `chat_session` + `chat_message` (project-scoped, soft-link sessions) |

### Frontend additions
| File | Role |
|------|------|
| `dashboard/src/pages/LibraryPage.tsx` | Browse / CRUD skills + materials, file upload for material extraction |
| `dashboard/src/components/projects/ProjectChatPanel.tsx` | Chat panel inside project detail, session history, tool-call inline display |
| `dashboard/src/components/projects/modals/` | (subdir) — modals for project ops |
| `dashboard/src/components/projects/sections/` | (subdir) — split sections of project detail |
| `dashboard/src/components/projects/ui/` | (subdir) — UI primitives |
| `dashboard/src/components/shared/Modal.tsx` | Shared modal |

### Skills additions (3 new)
- `skills/fk-add-entity.md` — entity helper
- `skills/fk-add-video.md` — video helper
- `skills/SKILLS_STAGES.md` — meta doc grouping skills by pipeline stage

### External dependency added
- **"9Router"** — OpenAI-compatible LLM gateway, configurable via `ROUTER_HOST` (default `127.0.0.1:20128`) + `ROUTER_API_KEY`. Not bundled. User must run separately.

---

## Architectural Pattern (How It Works)

```
[User in Dashboard]
       │
       │ POST /chat {messages, project_id, session_id, model}
       ▼
[chat.py]
  ├── 1. Persist user message to chat_message
  ├── 2. Detect /fk-* skill → if match, execute directly (skill_executor)
  ├── 3. Else build system prompt = CLAUDE.md + AGENTS.md + skills list
  └── 4. Forward to 9Router with FLOWKIT_TOOLS
       │
       ▼
[9Router] (external) ──► LLM (OpenAI-compatible)
       │
       ▼
[run_tool_loop_stream]
  for round in 1..15:
    response = LLM.chat.completions(messages, tools, stream=True)
    if response.tool_calls:
      for tc in tool_calls:
        result = execute_tool_call("flowkit_api", {method, path, body})
        # internally calls http://127.0.0.1:8100{path}
      append tool results to messages
      continue loop
    else:
      stream content to client → done
```

**Key insight:** LLM gets ONE generic tool — `flowkit_api(method, path, body)` — and the FastAPI's existing routes ARE the action surface. No need to wrap each endpoint as a separate tool. System prompt + `GET /openapi.json` + skill list teaches LLM the API shape.

---

## Dependency Matrix (vs local)

| Component | Local has? | Source delta |
|-----------|-----------|--------------|
| FastAPI app | ✅ | + 3 routers (chat, skills, tool_executor) |
| SQLite schema | ✅ | + chat_session + chat_message tables |
| WebSocket bridge | ✅ | unchanged |
| Worker queue | ✅ | unchanged |
| Skills `.md` library | ✅ (36 skills) | +3 skills, + meta doc |
| Dashboard | ✅ (5 pages, view-only) | + LibraryPage, + ProjectChatPanel, + ~5 component dirs |
| LLM integration | ❌ none | + 9Router proxy + tool loop |
| Chat persistence | ❌ none | + new DB tables |

---

## Decision Matrix

| Decision | Source's way | Local's way | Recommendation |
|----------|-------------|------------|----------------|
| Workflow trigger UI | Chat panel inside ProjectDetail | None (use Claude Code CLI externally) | Source's pattern is genuinely better for non-dev users |
| LLM access | External 9Router gateway | Claude Code CLI subprocess (in `video_reviewer.py`) | **Local approach simpler** — already have CLI authenticated |
| Tool surface | Single `flowkit_api(method,path,body)` | N/A | **Adopt this** — elegant, no per-endpoint wrappers |
| Chat persistence | DB tables `chat_session`/`chat_message` | N/A | Adopt if building chat UI |
| Skill execution from chat | Regex detect `/fk-*`, run directly bypassing LLM | Claude Code reads `.md` and executes | Source's interception saves tokens for known skills |
| LLM provider lock-in | 9Router (custom) — must be running | Claude Code (already running) | **Local could leverage Claude CLI subprocess** instead of OpenAI-compatible gateway |
| Frontend state | Per-project chat sessions | N/A | Adopt session list + history pattern |

---

## Challenge Questions (5 hard questions)

### 1. Why introduce a 9Router dependency when Claude Code CLI is already the chosen LLM?
- **Source assumes:** OpenAI-compatible API is universal; users have own gateway.
- **Local context:** `video_reviewer.py:333-396` already does Claude CLI subprocess fallback. User is on Claude Code.
- **Risk:** Forking the architecture adds runtime dep (port 20128) without clear benefit. **The local fork could swap 9Router → `claude` CLI subprocess** and skip the entire OpenAI-compatible plumbing.

### 2. Single generic `flowkit_api` tool — is 15 rounds enough for real pipelines?
- **Source assumes:** `max_rounds=15` covers typical request flows.
- **Concern:** A full pipeline (`/fk-pipeline --tts --concat`) involves 30+ scenes × multiple ops = far more rounds. The chat would TIMEOUT or hit limit.
- **Mitigation:** Source's regex-intercept of `/fk-*` skills bypasses LLM for known workflows — chat is for **ad-hoc ops**, not full pipelines. Pipelines still go through the queue + worker.

### 3. Security — LLM with unrestricted POST/PATCH/DELETE on local API?
- **Source:** No tool whitelist. LLM can call any endpoint including `DELETE /api/projects/{id}`.
- **Risk:** Prompt injection via uploaded image filenames, project descriptions, or chat history → LLM tricked into destructive op.
- **Mitigation needed before adopt:** Tool allowlist (read-only for `DELETE`), confirmation modal for destructive ops, audit log of tool calls.

### 4. Cost — every chat turn hits LLM API. How is token bloat managed?
- **Source:** System prompt = full `CLAUDE.md` + `AGENTS.md` + all skill descriptions. Cached in process (`_system_prompt_cache`) but sent every request.
- **Estimate:** ~5K tokens system + ~2K context per project = $0.01-0.05 per turn (Sonnet). 100 turns/day = $1-5/day per user.
- **Local advantage:** Claude Code subscription = unlimited. **Adopting this pattern with Claude CLI subprocess = $0 marginal cost**.

### 5. Compare to Claude Code CLI — is reinventing the chat UI worth it?
- **Source's UX:** Browser tab, no terminal, project-scoped chat history, inline tool calls.
- **Claude Code's UX:** Terminal, but rich autocomplete, file context, session history, transcript export.
- **Real gap:** Non-developers (content creators, video producers) won't open a terminal. **Source's chat UI directly addresses this user segment.**
- **Recommendation:** Adopt for end-user UX, but use Claude CLI subprocess as the LLM backend to avoid 9Router dep.

---

## Risk Score: MEDIUM-LOW

| Dimension | Score | Note |
|-----------|-------|------|
| Architectural fit | 🟢 LOW | New routers/components are additive, don't touch worker/Veo path |
| Stack mismatch | 🟢 LOW | Same FastAPI + React + SQLite |
| Security | 🟡 MEDIUM | LLM with API write access needs guardrails |
| Cost | 🟡 MEDIUM | LLM API spend if not using Claude CLI |
| Maintenance | 🟡 MEDIUM | Adds chat UX as a maintained surface — chat support, history, sessions |
| Lock-in | 🟢 LOW | If swap 9Router → Claude CLI, no external dep |

---

## Recommendation

**Adopt the pattern, swap the backend.**

Specifically:
1. ✅ **Port the architecture** — `chat.py`, `tool_executor.py`, `skills.py`, `skill_executor.py`, schema additions.
2. 🔄 **Replace 9Router with Claude CLI subprocess** — reuse pattern from `agent/services/video_reviewer.py:_call_claude_cli` (already exists locally). Stream output via NDJSON.
3. 🛡️ **Add tool guardrails** — whitelist `GET`/`POST` only for chat tool calls; require explicit confirmation flow for `DELETE`/destructive `PATCH` (e.g. project archive).
4. 📦 **Port frontend** — `LibraryPage`, `ProjectChatPanel`, `Modal`. Keep their session/history pattern — it's good UX.
5. ✂️ **Skip** — `fk-add-entity.md` and `fk-add-video.md` (likely thin shortcuts already covered by `/fk-create-project`); `SKILLS_STAGES.md` (meta doc, low value).

### Phased plan (if greenlit)

| Phase | Scope | Effort |
|-------|-------|--------|
| **P1: Backend MVP** | `tool_executor.py` + `chat.py` + DB migration. Use Claude CLI as LLM. No frontend. Test via curl. | ~1 day |
| **P2: Frontend MVP** | `ProjectChatPanel` only (no LibraryPage). Wire to P1 endpoint. | ~1 day |
| **P3: Library page + skill CRUD** | `LibraryPage` + skills.py API. Browse/run skills from UI. | ~1 day |
| **P4: Guardrails** | Tool allowlist, destructive-op confirmation, audit log. | ~0.5 day |

Total: **3-4 days** for full feature parity with security improvements over source.

---

## Why this answers your "workflow on dashboard" question

Your earlier question (10:44 AM): *"tôi muốn làm workflow trên giao diện dashboard được không?"*

My earlier answer: dashboard is view-only, would need ~3-5 days to build operator UI.

**This repo proves it's feasible** — they did exactly that in a single commit. The chat-driven approach is actually cleaner than per-button forms because:
- One UI affordance (chat input) handles all operations
- LLM handles intent parsing → no need to design 50 forms for 50 skills
- Natural-language matches non-dev mental model (the target audience for video creators)

The architectural recipe is now visible. Whether to adopt is your call.

---

## Unresolved Questions

1. Does upstream `tuannguyenhoangit-droid/google-flow-agent` plan a similar feature? (Their roadmap might already have it — check before duplicating.)
2. Is "9Router" a public project or zach94's private gateway? (Couldn't find a repo by that name in 60s search — may be internal.)
3. License of source: MIT — porting allowed, but need to credit the source patterns when adopting.
4. The fork has 0 stars / 1 commit / 2 days old — is it abandoned, or actively developed elsewhere? Checking back in a week may yield more delta.
5. Does the source handle WebSocket disconnect mid-tool-call? (Didn't see retry logic in the loop code.)
