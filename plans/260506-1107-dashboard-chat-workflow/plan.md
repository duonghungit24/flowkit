---
title: "Dashboard AI Chat Workflow UI"
description: "Add browser-based natural-language workflow trigger via Claude CLI subprocess; targets non-terminal users while preserving terminal Claude Code path."
status: pending
priority: P1
effort: 4.5d
branch: main
tags: [chat, dashboard, llm, fastapi, react]
created: 2026-05-06
---

# Dashboard AI Chat Workflow UI

## Overview

Adds a chat panel to the project detail page so non-terminal users can trigger
FlowKit workflows via natural language. LLM backend = Claude CLI subprocess
(reuses `video_reviewer.py` pattern). No new external deps.

Scope: P1 + P2 + P3 + P4 + P5. Full feature parity with source repo + Claude CLI swap + guardrails + multi-LLM (Claude + Codex).

## Reference

- Source compare report: `plans/reports/xia-260506-1053-agent-flowkit-chat-ui.md`
- Source repo pattern: `zach94-fullstack/agent-flowkit` (MIT)

## Phases

| Phase | File | Status | Effort | Blocker |
|-------|------|--------|--------|---------|
| P1: Backend MVP | [phase-01-backend-mvp.md](./phase-01-backend-mvp.md) | done | ~1d | none |
| P2: Frontend Chat | [phase-02-frontend-chat.md](./phase-02-frontend-chat.md) | done | ~1d | P1 done |
| P3: Library Page | [phase-03-library-page.md](./phase-03-library-page.md) | done | ~1d | P1+P2 done |
| P4: Guardrails | [phase-04-guardrails.md](./phase-04-guardrails.md) | done | ~0.5d | P1+P2 done |
| P5: Codex Backend | [phase-05-codex-backend.md](./phase-05-codex-backend.md) | pending | ~1d | P1+P2 done |

## Key Dependencies

- `claude` CLI must be on `$PATH` (already required by video reviewer)
- `httpx` already in venv (used by tool_executor HTTP calls back to self)
- `aiosqlite` already in venv (new chat tables)
- Dashboard: no new npm deps; uses existing fetch + React 19 state

## Data Flow (end-to-end)

```
Browser input
  → POST /api/chat {messages, project_id, session_id?}
  → chat.py: persist user msg → detect /fk-* → build system prompt
  → llm_bridge.py: spawn `claude --print --output-format stream-json`
  → NDJSON stream back to browser
  → tool_call events → tool_executor.py → httpx → localhost:8100/api/*
  → tool_result events streamed to browser
  → done event → browser saves session_id for next turn
```

## Rollback

- P1: new routers are additive; remove imports from `main.py` + drop new tables (ALTER TABLE has no rollback in SQLite but tables can be dropped)
- P2: new components only; revert `ProjectDetailPage.tsx` tab addition
- P3: new route + page; revert NavLink + Route in `App.tsx`; new components are isolated under `components/library/`
- P4: guarded by feature flag check in `tool_executor.py`; revert allowlist logic to passthrough
- P5: revert factory to direct Claude call in `chat.py`; remove `llm_backends/` dir; existing sessions with `model="codex*"` → fallback to Claude with warning
