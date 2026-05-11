# P1 — Backend Rebind Support

## Overview

- **Priority**: P1
- **Status**: pending
- **Effort**: ~0.3d

Add session-level rebind so a draft chat session (project_id=NULL) can adopt a
real project once `/fk-create-project` succeeds. Two paths:

1. **Manual** — `PATCH /api/chat/sessions/{sid}` with `{project_id}` body.
2. **Auto** — chat backend detects successful `POST /api/projects` tool_result;
   if session has no project_id, set it server-side + emit `session_rebind` NDJSON event.

## Key Insights

- `chat_session.project_id` already nullable (`agent/db/schema.py:156-163`). No migration needed.
- Tool execution funnel = `agent/api/chat.py` → `tool_executor.py`. Hook into result phase.
- Drift safety: only auto-rebind when `session.project_id IS NULL` (don't override a deliberately-bound session).

## Requirements

- `PATCH /api/chat/sessions/{sid}` body `{project_id: str | null}`. Validates project exists; returns updated session.
- New CRUD: `update_chat_session_project(sid, project_id)` — column-whitelisted.
- Auto-rebind in `chat.py` stream loop:
  - After tool_result for `POST /api/projects` (status 200/201, parsed JSON has `id`):
  - If session.project_id IS NULL → UPDATE + emit `{"type":"session_rebind","session_id":sid,"project_id":<new_id>}`.
- `chat-api.ts` types: extend `NdjsonEvent` union with `session_rebind`.

## Files

**Modify:**
- `agent/api/chat.py` — add PATCH route + auto-rebind hook in stream loop.
- `agent/db/crud.py` — add `update_chat_session_project`. Whitelist `project_id` in chat_session updates.
- `dashboard/src/types/index.ts` — add `session_rebind` event variant.
- `dashboard/src/api/chat-api.ts` — add `rebindSession(sid, project_id)` helper.

**No changes:**
- Schema (already nullable).

## Implementation Steps

1. `crud.update_chat_session_project(sid: str, project_id: str | None) -> dict | None` — UPDATE + RETURNING-style read-back; bump `updated_at`.
2. Add PATCH route in `chat.py`. Body model `RebindBody(project_id: str | None)`. 404 if session missing; 400 if project_id provided but project not found.
3. Locate tool-result handler in `chat.py` stream loop. After `tool_executor` returns success for path matching `^/api/projects/?$` and method POST:
   - Parse response JSON for `id` field (project create returns `{id, name, ...}`).
   - Read current session row; if `project_id IS NULL`, call `update_chat_session_project`.
   - Yield NDJSON `{"type":"session_rebind","session_id":sid,"project_id":<id>}` BEFORE the next iteration.
4. Frontend types + helper. No UI in this phase — drawer consumes the event in P4.
5. Smoke test: `pytest tests/unit/` passes; manual `curl PATCH` to verify endpoint.

## Todo

- [ ] crud helper + whitelist
- [ ] PATCH /chat/sessions/{sid}
- [ ] auto-rebind hook in stream loop
- [ ] NDJSON event type addition
- [ ] frontend api helper
- [ ] manual curl test for both manual + auto paths

## Success Criteria

- POST `/api/projects` from inside a draft chat session results in `chat_session.project_id` being set without manual UI action.
- PATCH endpoint changes project_id and validates project existence.
- NDJSON consumer can receive `session_rebind` event.
- No regressions in existing chat tests.

## Risks

- **Race**: tool_result handled async — ensure UPDATE happens before emitting event so frontend refetch sees consistent state. Mitigation: await UPDATE then yield.
- **Misidentify route**: `POST /api/projects` vs `POST /api/projects/{id}/something`. Mitigation: strict path regex `^/api/projects/?$` (no trailing path segments).
- **JSON parse fail**: tool_result content might be string or dict depending on executor format. Mitigation: try/except, no rebind on parse failure.

## Security

- PATCH body validates project FK — prevents arbitrary string injection.
- Auto-rebind only fires for session owner (single-user system, no auth layer to bypass).
