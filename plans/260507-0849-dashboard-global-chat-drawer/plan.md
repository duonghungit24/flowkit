---
title: "Dashboard Global Chat Drawer"
description: "Decouple chat from project detail page. Floating drawer w/ project picker, draft (soft-project) mode, auto-rebind on /fk-create-project."
status: pending
priority: P1
effort: 2d
branch: feat_dashboard
tags: [chat, dashboard, ux, drawer, fastapi, react]
created: 2026-05-07
---

# Dashboard Global Chat Drawer

## Problem

Current chat lives inside `ProjectDetailPage` Chat tab — user must enter a project
to chat, and switching project = navigate away + lose draft. Backend already
supports `project_id=null` (nullable column + Optional in router), so the gap
is purely UI.

## Solution

Floating chat drawer accessible from anywhere in the dashboard:

- **Trigger**: floating button (bottom-right), lucide `MessageSquare`.
- **Project picker**: dropdown at drawer top — `[Draft]` + projects sorted by `updated_at`.
- **Draft (soft project)**: `project_id=null` session, persisted in `localStorage`.
- **Auto-rebind**: when chat detects `POST /api/projects` tool_result success, server
  updates session `project_id` and emits `session_rebind` NDJSON event.
- **ProjectDetailPage**: replace Chat tab with "Open Chat" button → opens drawer
  pre-selected to that project. Single chat surface.

## Phases

| Phase | File | Status | Effort | Blocker |
|-------|------|--------|--------|---------|
| P1: Backend rebind | [phase-01-backend-rebind.md](./phase-01-backend-rebind.md) | pending | ~0.3d | none |
| P2: Reusable ChatPanel | [phase-02-refactor-chat-panel.md](./phase-02-refactor-chat-panel.md) | pending | ~0.4d | none |
| P3: Drawer + trigger | [phase-03-drawer-shell.md](./phase-03-drawer-shell.md) | pending | ~0.5d | P2 |
| P4: Project picker + draft | [phase-04-picker-draft.md](./phase-04-picker-draft.md) | pending | ~0.5d | P1+P3 |
| P5: ProjectDetailPage integration | [phase-05-project-detail-integration.md](./phase-05-project-detail-integration.md) | pending | ~0.3d | P3+P4 |

## Reference

- Existing chat plan: `plans/260506-1107-dashboard-chat-workflow/`
- Current chat panel: `dashboard/src/components/projects/ProjectChatPanel.tsx`
- Chat router: `agent/api/chat.py`
- Schema: `agent/db/schema.py:156-163` (chat_session, project_id nullable)

## Data Flow (rebind)

```
User in Draft → "create me a project called Foo"
  → claude tool_use: POST /api/projects {name: "Foo"}
  → chat backend executes tool → 201 {id: "abc-123"}
  → chat backend: if session.project_id is NULL, UPDATE chat_session SET project_id='abc-123'
  → emit NDJSON: {type:"session_rebind", session_id, project_id:"abc-123"}
  → drawer: switch picker to project "Foo", refresh session list
```

## Rollback

- P1: drop new endpoint + migration is idempotent (no schema change, only nullable usage).
- P2: refactor is internal; revert renames.
- P3: new component + button — remove import from `App.tsx`.
- P4: revert picker section in drawer.
- P5: re-add Chat tab in `ProjectDetailPage.tsx`.
