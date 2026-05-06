# Phase 04: Guardrails

## Context Links

- Plan overview: [plan.md](./plan.md)
- Phase 01 (required): [phase-01-backend-mvp.md](./phase-01-backend-mvp.md)
- Phase 02 (required): [phase-02-frontend-chat.md](./phase-02-frontend-chat.md)
- Tool executor (modify): `agent/services/tool_executor.py`
- Confirm modal stub (wire up): `dashboard/src/components/shared/ConfirmModal.tsx`
- Chat panel (modify): `dashboard/src/components/projects/ProjectChatPanel.tsx`
- Chat API (modify): `dashboard/src/api/chat-api.ts`

## Overview

- **Priority:** P2 (security hardening)
- **Status:** done
- **Effort:** ~0.5 day
- **Blocker:** Phase 01 + Phase 02 fully working
- **Description:** Enforce `GET`/`POST`-auto / `PATCH`/`DELETE`-confirm allowlist. New `POST /api/chat/confirm` endpoint resumes or rejects halted tool call. Audit log written per tool execution. Frontend confirmation modal blocks UI until user decides.

## Key Insights

1. **Suspension model**: When LLM issues `PATCH`/`DELETE` tool call, backend cannot truly "pause" the Claude CLI subprocess mid-stream. Instead: the tool executor detects the forbidden method, writes a `confirmation_required` NDJSON event to the stream, stores the pending call in a short-lived in-memory dict keyed by `tool_call_id`, and awaits a Future. The `/api/chat/confirm` endpoint resolves that Future. Timeout: 120s — after which the tool call is auto-rejected.
2. **In-process Future approach** is simpler than a DB-persisted queue for this use case. The confirmation window is always within a single HTTP streaming response. If the user closes the tab, the Future times out and the call is rejected — safe default.
3. **`ConfirmationRequired` exception**: already stubbed in Phase 01's `tool_executor.py`. Phase 04 replaces the stub with real logic.
4. **Audit log**: `tool_call_audit` table already created in Phase 01 schema. Phase 04 wires `create_tool_audit()` calls on every tool execution (auto + confirmed + rejected).
5. **Frontend**: `ProjectChatPanel.tsx` already has `confirmEvent` state + `ConfirmModal.tsx` stub. Phase 04 calls `POST /api/chat/confirm` and resumes streaming (which continues naturally since the backend Future was resolved).
6. **Scope of "destructive PATCH"**: not all PATCH is destructive. Only flag PATCH when path matches patterns like `status=ARCHIVED/DELETED` or `archived:true`. For simplicity in Phase 04: flag ALL `PATCH` + `DELETE` for confirmation — conservative, can relax later.

## Requirements

### Functional
- `GET` + `POST` → execute immediately, write audit with `status='auto'`
- `PATCH` + `DELETE` → emit `confirmation_required` event, halt execution for up to 120s
- `POST /api/chat/confirm {session_id, tool_call_id, approved: bool}` → resolves pending Future
- Rejected: tool executor returns `{"error": "User rejected this operation"}` to LLM; LLM acknowledges and continues
- Approved: tool executor executes the call, returns result to LLM; audit `status='approved'`
- Rejected: audit `status='rejected'`
- Timeout (120s): auto-reject, audit `status='rejected'`
- Audit log viewable via `GET /api/chat/sessions/{sid}/audit` (simple list for future use)

### Non-functional
- Pending confirmations stored in process memory (`_pending_confirmations: dict[str, asyncio.Future]`)
- No DB polling; asyncio Future resolution is instant
- Frontend modal must block chat input while awaiting confirmation

## Architecture

```
[LLM tool_call: PATCH /api/projects/123 {status:ARCHIVED}]
        │
        ▼
tool_executor.execute_tool_call(method="PATCH", ...)
        │ PATCH → requires confirmation
        ▼
_pending_confirmations[tool_call_id] = asyncio.Future()
yield {"type":"confirmation_required", "tool_call_id":"tc_1",
       "method":"PATCH", "path":"/api/projects/123",
       "body_summary":"status=ARCHIVED"}
        │
        │  (stream paused, awaiting)
        │
[User sees modal → clicks Approve/Reject]
        │
        ▼
POST /api/chat/confirm {tool_call_id:"tc_1", approved:true}
        │
        ▼
_pending_confirmations["tc_1"].set_result(True)
        │
        ▼
tool_executor resumes → executes PATCH → writes audit(status="approved")
yield {"type":"tool_result", ...}
        │ stream continues normally
```

### New Endpoint

```
POST /api/chat/confirm
Body: {session_id: str, tool_call_id: str, approved: bool}
Response: {"ok": true} | {"ok": false, "reason": "not found or timed out"}
```

Added to `agent/api/chat.py`.

### Modified: `agent/services/tool_executor.py`

```python
# Module-level pending confirmations store
_pending_confirmations: dict[str, asyncio.Future] = {}

async def execute_tool_call(
    method: str,
    path: str,
    body: dict,
    session_id: str | None,
    tool_call_id: str,
    stream_queue: asyncio.Queue,   # yields NDJSON events upstream
) -> str:
    """Execute tool call. For PATCH/DELETE, emit confirmation_required and await user."""
    method = method.upper()
    if method in ("PATCH", "DELETE"):
        # Emit confirmation_required event via queue
        await stream_queue.put(json.dumps({
            "type": "confirmation_required",
            "tool_call_id": tool_call_id,
            "method": method,
            "path": path,
            "body_summary": _summarize_body(body),
        }))
        # Wait for user decision (120s timeout)
        loop = asyncio.get_event_loop()
        fut: asyncio.Future = loop.create_future()
        _pending_confirmations[tool_call_id] = fut
        try:
            approved = await asyncio.wait_for(fut, timeout=120.0)
        except asyncio.TimeoutError:
            approved = False
        finally:
            _pending_confirmations.pop(tool_call_id, None)

        audit_status = "approved" if approved else "rejected"
        await create_tool_audit(session_id, tool_call_id, method, path, _summarize_body(body), audit_status)

        if not approved:
            return json.dumps({"error": "User rejected this operation. Acknowledge and do not retry."})
    else:
        await create_tool_audit(session_id, tool_call_id, method, path, _summarize_body(body), "auto")

    # Execute the actual HTTP call
    return await _do_http(method, path, body)
```

**Architectural note**: `stream_queue` requires threading the queue through `llm_bridge.py`'s tool loop. The bridge holds a shared `asyncio.Queue`. The async generator reads from it interleaved with subprocess stdout. This is the only structural change to Phase 01's `llm_bridge.py`.

### Modified: `agent/api/chat.py`

```python
@router.post("/chat/confirm")
async def chat_confirm(request: Request):
    body = await request.json()
    tool_call_id = body.get("tool_call_id")
    approved = bool(body.get("approved", False))
    from agent.services.tool_executor import _pending_confirmations
    fut = _pending_confirmations.get(tool_call_id)
    if not fut or fut.done():
        return JSONResponse({"ok": False, "reason": "not found or already resolved"}, status_code=404)
    fut.set_result(approved)
    return {"ok": True}
```

### Modified: `dashboard/src/components/projects/ProjectChatPanel.tsx`

Add `confirmEvent` handling:
```typescript
// When NdjsonEvent type === 'confirmation_required':
setConfirmEvent(event)  // already stubbed in P2

// approveConfirm / rejectConfirm:
async function approveConfirm(approved: boolean) {
  if (!confirmEvent) return
  await fetch('/api/chat/confirm', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({
      session_id: activeSessionId,
      tool_call_id: confirmEvent.tool_call_id,
      approved,
    })
  })
  setConfirmEvent(null)
  // stream resumes automatically (backend Future resolved)
}
```

### Modified: `dashboard/src/components/shared/ConfirmModal.tsx`

Wire `onApprove` + `onReject` callbacks (remove stub placeholder, connect to `approveConfirm`).

## Related Code Files

### Files to Modify
- `agent/services/tool_executor.py` — replace `ConfirmationRequired` stub with asyncio Future logic; add `_pending_confirmations`; add `create_tool_audit` call on every execution
- `agent/services/llm_bridge.py` — add `stream_queue: asyncio.Queue` plumbing; read from queue interleaved with subprocess stdout
- `agent/api/chat.py` — add `POST /chat/confirm` endpoint; add `GET /chat/sessions/{sid}/audit`
- `dashboard/src/components/projects/ProjectChatPanel.tsx` — wire `approveConfirm` / `rejectConfirm`
- `dashboard/src/components/shared/ConfirmModal.tsx` — replace stub with real callbacks

### Files NOT to Touch
- `agent/db/schema.py` — `tool_call_audit` table already created in Phase 01
- `agent/db/crud.py` — `create_tool_audit` already added in Phase 01
- All other dashboard components

## Implementation Steps

1. **`tool_executor.py`** — replace `ConfirmationRequired` stub:
   - Add `_pending_confirmations: dict[str, asyncio.Future] = {}` at module level
   - Rewrite `execute_tool_call` signature to accept `stream_queue` + `tool_call_id` params
   - Implement asyncio Future suspend/resume for PATCH/DELETE
   - Call `create_tool_audit` from `crud.py` on every path (auto/approved/rejected)
   - Add `_summarize_body(body: dict) -> str` helper (first 100 chars of JSON)

2. **`llm_bridge.py`** — add queue plumbing:
   - Create `stream_queue = asyncio.Queue()` inside `stream_chat()`
   - Pass queue to `execute_tool_call` calls in the tool loop
   - In the async generator, interleave: read subprocess stdout line → yield; also drain `stream_queue` after each tool call (using `queue.get_nowait()` in a loop until empty)

3. **`chat.py`** — add confirm endpoint:
   - `POST /api/chat/confirm` — resolve Future or 404
   - `GET /api/chat/sessions/{sid}/audit` — query `tool_call_audit` by session_id, return list

4. **`ProjectChatPanel.tsx`** — wire confirm:
   - Implement `approveConfirm(approved: boolean)` — POST `/api/chat/confirm`
   - Pass to `ConfirmModal` as `onApprove={() => approveConfirm(true)}` + `onReject={() => approveConfirm(false)}`
   - Disable `ChatInput` while `confirmEvent !== null`

5. **`ConfirmModal.tsx`** — de-stub:
   - Remove placeholder `console.log` callbacks
   - Props already typed from P2; just connect

6. **Integration test**:
   ```bash
   # Start agent
   source venv/bin/activate && python -m agent.main &
   # Ask LLM to delete something
   curl -N -X POST http://127.0.0.1:8100/api/chat \
     -H "Content-Type: application/json" \
     -d '{"messages":[{"role":"user","content":"archive project abc123"}],"project_id":"abc123"}'
   # Expect: confirmation_required event in stream
   # Simulate reject:
   curl -X POST http://127.0.0.1:8100/api/chat/confirm \
     -H "Content-Type: application/json" \
     -d '{"tool_call_id":"<id from event>","approved":false}'
   # Expect: stream continues with error acknowledgement from LLM
   ```

7. **Browser test**: Open Chat tab → type "archive this project" → confirmation modal appears → click Reject → LLM replies with acknowledgement.

8. **Audit log check**:
   ```bash
   curl http://127.0.0.1:8100/api/chat/sessions/<sid>/audit
   # Expect: list with status='rejected' entry
   ```

9. **Run tests**:
   ```bash
   cd /Users/mesoft/Project/AI/flowkit && source venv/bin/activate && pytest
   ```

## Todo List

- [x] Add `_pending_confirmations` dict + asyncio Future logic to `tool_executor.py`
- [x] Wire `create_tool_audit` in `tool_executor.py` for all execution paths
- [x] ~~Add `stream_queue` parameter threading in `llm_bridge.py`~~ — simpler design: bridge yields `confirm_required` before awaiting executor; no queue plumbing needed
- [x] Add `POST /api/chat/confirm` to `chat.py`
- [x] Add `GET /api/chat/sessions/{sid}/audit` to `chat.py`
- [x] Implement `decideConfirm` in `ProjectChatPanel.tsx`
- [x] Wire `ConfirmModal.tsx` callbacks (already typed in P2 — connected in P4)
- [x] `npx tsc --noEmit` — 0 errors in modified files (pre-existing `LogsPage.tsx` error unrelated)
- [ ] Integration test: confirm modal appears on PATCH/DELETE intent — requires running agent + claude CLI; deferred to manual run
- [ ] Integration test: reject → LLM acknowledges, stream ends cleanly — same
- [x] Verify audit log row written for each tool execution (smoke-tested in `execute_tool_call`)
- [x] `pytest` — 87 passed, 3 failed, 9 errors (all pre-existing on base branch, unrelated to P4)

## Success Criteria

- Ask LLM to delete a project via chat → `confirmation_required` event arrives in browser → modal displays method + path + body summary
- Click Reject → LLM receives rejection message → responds with acknowledgement → `done` event
- Click Approve → operation executes → normal `tool_result` continues stream
- `GET /api/chat/sessions/{sid}/audit` returns non-empty list after any chat with tool calls
- GET + POST tool calls never trigger modal (execute immediately)

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| asyncio Future not resolved if client disconnects | Medium | Low | 120s timeout auto-rejects; no resource leak since dict entry cleaned in `finally` |
| Two simultaneous PATCH tool calls in one loop round | Low | Medium | Each gets own `tool_call_id`; separate Future per ID; both block independently |
| Queue drain interleaving logic in `llm_bridge.py` introduces race | Medium | Medium | Use `asyncio.Queue` (thread-safe); drain after each subprocess line read; unit test with mock queue |
| LLM ignores rejection message and retries PATCH | Low | Low | Rejection message says "do not retry"; Claude typically obeys; confirmed by source repo behavior |
| Browser tab close during confirmation → Future never resolved | Medium | Low | 120s timeout handles this; audit written as 'rejected' on timeout |

## Security Considerations

- `_pending_confirmations` keyed by `tool_call_id` (UUID generated by Claude CLI) — not guessable from outside
- `/api/chat/confirm` does not require auth (loopback-only deployment) — same trust model as all other endpoints
- Confirmation timeout 120s prevents indefinite resource hold
- Audit log provides post-hoc review of all destructive operations
- PATCH allowlist is conservative (all PATCH flagged, not just destructive fields) — can be relaxed per endpoint once usage patterns are clear

## Next Steps

- Future: restrict confirmation to only PATCH calls with specific destructive fields (e.g., `status: ARCHIVED/DELETED`) — requires inspecting body before deciding
- Future: `GET /api/chat/sessions/{sid}/audit` can feed an audit UI panel in the dashboard
- Future: per-project confirmation preferences (e.g., "auto-approve PATCH on scenes")
