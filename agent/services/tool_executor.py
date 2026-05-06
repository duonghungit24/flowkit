"""Tool executor — executes flowkit_api calls from the chat LLM via httpx loopback.

Single tool: flowkit_api(method, path, body). Calls back into the local agent
on http://127.0.0.1:8100. PATCH/DELETE/PUT (mutating methods) suspend on an
asyncio Future until the user approves or rejects via POST /api/chat/confirm,
or the timeout (120s) auto-rejects. GET/POST execute immediately.
"""
import asyncio
import json
import logging
from typing import Any, Optional

import httpx

from agent.config import API_PORT
from agent.db import crud

logger = logging.getLogger(__name__)

_LOOPBACK_BASE = f"http://127.0.0.1:{API_PORT}"
_REQUEST_TIMEOUT = 60.0
_MUTATING_METHODS = {"PATCH", "DELETE", "PUT"}
_CONFIRM_TIMEOUT_SECONDS = 120.0

# Pending confirmation Futures keyed by tool_call_id. Resolved by
# POST /api/chat/confirm. Cleaned up in the finally block of execute_tool_call.
_pending_confirmations: dict[str, asyncio.Future] = {}

# Tool schema — passed to the LLM via the system prompt as context, NOT via
# Claude's native tool API (CLI subprocess doesn't support custom tools).
FLOWKIT_TOOLS: list[dict] = [
    {
        "name": "flowkit_api",
        "description": (
            "Call any FlowKit REST endpoint on the local agent. "
            "Use GET to read state, POST to create/queue, PATCH to update, DELETE to remove. "
            "Body is a JSON-serialisable object (omit for GET)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "method": {"type": "string", "enum": ["GET", "POST", "PATCH", "DELETE", "PUT"]},
                "path": {"type": "string", "description": "Path starting with /api/..."},
                "body": {"type": "object", "description": "JSON body (POST/PATCH/PUT only)"},
            },
            "required": ["method", "path"],
        },
    }
]


def needs_confirmation(method: str, auto_approve_mutations: bool = False) -> bool:
    """Return True when the call must wait for explicit user approval."""
    return method.upper() in _MUTATING_METHODS and not auto_approve_mutations


def resolve_confirmation(tool_call_id: str, approved: bool) -> bool:
    """Resolve a pending confirmation Future. Returns True on success."""
    fut = _pending_confirmations.get(tool_call_id)
    if fut is None or fut.done():
        return False
    fut.set_result(approved)
    return True


def _summarise_body(body: Optional[dict], limit: int = 200) -> Optional[str]:
    if body is None:
        return None
    try:
        s = json.dumps(body, ensure_ascii=False)
    except Exception:
        s = str(body)
    return s if len(s) <= limit else s[:limit] + "..."


def _normalise_path(path: str) -> str:
    if not path.startswith("/"):
        path = "/" + path
    return path


async def _await_user_decision(tool_call_id: str) -> bool:
    """Park on a Future until /api/chat/confirm resolves it, or timeout rejects."""
    loop = asyncio.get_event_loop()
    fut: asyncio.Future = loop.create_future()
    _pending_confirmations[tool_call_id] = fut
    try:
        return bool(await asyncio.wait_for(fut, timeout=_CONFIRM_TIMEOUT_SECONDS))
    except asyncio.TimeoutError:
        logger.info("tool_call %s confirmation timed out", tool_call_id)
        return False
    finally:
        _pending_confirmations.pop(tool_call_id, None)


async def execute_tool_call(
    method: str,
    path: str,
    body: Optional[dict] = None,
    *,
    session_id: Optional[str] = None,
    message_id: Optional[str] = None,
    tool_call_id: Optional[str] = None,
    auto_approve_mutations: bool = False,
) -> dict:
    """Execute a single flowkit_api tool call. Returns {status, body} dict.

    For PATCH/DELETE/PUT (unless auto_approve_mutations), suspends on an
    asyncio.Future awaiting the user decision. The caller (llm_bridge) is
    responsible for emitting the `confirm_required` event before invoking
    this function so the browser can render the modal.
    """
    method = (method or "GET").upper()
    path = _normalise_path(path or "/")
    body_summary = _summarise_body(body)

    # Restrict scope to /api/* + /health so the LLM can't escape.
    if not path.startswith("/api/") and path not in ("/health",):
        return {"status": 400, "body": {"error": f"path not allowed: {path}"}}

    if needs_confirmation(method, auto_approve_mutations):
        if not tool_call_id:
            # Defensive: bridge must always pass an id so /confirm can find us.
            return {"status": 500, "body": {"error": "tool_call_id missing for mutating call"}}
        approved = await _await_user_decision(tool_call_id)
        if session_id:
            await crud.create_tool_audit(
                session_id=session_id, method=method, path=path,
                body_summary=body_summary,
                status="approved" if approved else "rejected",
                message_id=message_id,
            )
        if not approved:
            return {
                "status": 403,
                "body": {"error": "User rejected this operation. Acknowledge and do not retry."},
            }
    else:
        if session_id:
            await crud.create_tool_audit(
                session_id=session_id, method=method, path=path,
                body_summary=body_summary,
                status="auto" if method not in _MUTATING_METHODS else "approved",
                message_id=message_id,
            )

    url = f"{_LOOPBACK_BASE}{path}"
    try:
        async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT) as client:
            resp = await client.request(method, url, json=body if body is not None else None)
        try:
            payload: Any = resp.json()
        except Exception:
            payload = resp.text
        return {"status": resp.status_code, "body": payload}
    except httpx.HTTPError as e:
        logger.warning("tool_executor httpx error: %s %s -> %s", method, path, e)
        return {"status": 599, "body": {"error": str(e)}}
