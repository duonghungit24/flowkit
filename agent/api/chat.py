"""Chat router — POST /api/chat (NDJSON stream) + session CRUD endpoints."""
import json
import logging
import re
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from agent.db import crud
from agent.services import skill_executor
from agent.services.llm_bridge import stream_chat

# Matches a curl creating a project: POST against /api/projects (no trailing
# path segment). Used by the auto-rebind hook in the chat stream.
_BASH_CREATE_PROJECT_RE = re.compile(
    r"""curl[^\n]*?
        (?:-X\s+POST|--request\s+POST)[^\n]*?
        /api/projects(?:/?\s|/?["'\s]|/?$)
    """,
    re.IGNORECASE | re.VERBOSE | re.DOTALL,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["chat"])

DEFAULT_MODEL = "claude-sonnet-4-5"
SESSION_TITLE_LIMIT = 60


class ChatMessage(BaseModel):
    role: str = Field(..., pattern="^(user|assistant|tool|system)$")
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    project_id: Optional[str] = None
    session_id: Optional[str] = None
    model: Optional[str] = None


class RebindBody(BaseModel):
    project_id: Optional[str] = None


def _looks_like_create_project_bash(tool_name: str, tool_input: dict) -> bool:
    """True when a Bash tool_use is a curl POST to /api/projects (root only)."""
    if tool_name != "Bash":
        return False
    cmd = tool_input.get("command")
    if not isinstance(cmd, str):
        return False
    return bool(_BASH_CREATE_PROJECT_RE.search(cmd))


def _extract_project_id_from_result(text: str) -> Optional[str]:
    """Find a project id in a tool_result body (curl output JSON or framed JSON)."""
    if not text:
        return None
    # Try the whole text as JSON first.
    candidates: list[str] = []
    stripped = text.strip()
    if stripped.startswith("{") and stripped.endswith("}"):
        candidates.append(stripped)
    # Fallback: scan for a JSON object containing "id":"<uuid>".
    uuid_re = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
    m = re.search(rf'"id"\s*:\s*"({uuid_re})"', stripped)
    if m:
        return m.group(1)
    for c in candidates:
        try:
            obj = json.loads(c)
        except json.JSONDecodeError:
            continue
        pid = obj.get("id") if isinstance(obj, dict) else None
        if isinstance(pid, str):
            return pid
    return None


def _derive_title(text: str) -> str:
    text = (text or "").strip().splitlines()[0] if text else ""
    return text[:SESSION_TITLE_LIMIT] or "New Chat"


@router.post("/chat")
async def chat_stream(req: ChatRequest):
    if not req.messages:
        raise HTTPException(status_code=400, detail="messages cannot be empty")
    last = req.messages[-1]
    if last.role != "user":
        raise HTTPException(status_code=400, detail="last message must be role=user")

    # Resolve or create session
    session_id = req.session_id
    if session_id:
        session = await crud.get_chat_session(session_id)
        if not session:
            raise HTTPException(status_code=404, detail=f"session not found: {session_id}")
    else:
        session = await crud.create_chat_session(
            project_id=req.project_id,
            title=_derive_title(last.content),
            model=req.model or DEFAULT_MODEL,
        )
        session_id = session["id"]

    # Persist user message before streaming
    await crud.create_chat_message(
        session_id=session_id,
        project_id=req.project_id,
        role="user",
        content=last.content,
    )

    # Skill intercept: /fk-<name> at start of last user message → inject skill body
    extra_system: Optional[str] = None
    skill_match = skill_executor.detect_skill_command(last.content)
    if skill_match:
        skill_name, _skill_args = skill_match
        skill_block = skill_executor.execute_skill(skill_name, _skill_args)
        if skill_block:
            extra_system = skill_block
        else:
            logger.info("skill not found: %s", skill_name)

    history = [m.model_dump() for m in req.messages]

    async def gen():
        final_text_parts: list[str] = []
        # Auto-rebind state: tool_use ids whose command is a `curl POST /api/projects`.
        # On the matching tool_result, if the session is still draft (no project_id),
        # we update it and emit a `session_rebind` event so the UI can switch.
        pending_create_tool_ids: set[str] = set()
        rebound_project_id: Optional[str] = req.project_id
        try:
            async for line in stream_chat(
                history,
                session_id=session_id,
                project_id=req.project_id,
                extra_system=extra_system,
            ):
                yield line
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                etype = obj.get("type")
                if etype == "text":
                    final_text_parts.append(obj.get("delta", ""))
                elif etype == "done" and obj.get("final_text"):
                    final_text_parts = [obj["final_text"]]
                elif etype == "tool_use":
                    if _looks_like_create_project_bash(
                        obj.get("name", ""), obj.get("input") or {}
                    ):
                        tid = obj.get("id") or ""
                        if tid:
                            pending_create_tool_ids.add(tid)
                elif etype == "tool_result":
                    tid = obj.get("id") or ""
                    if tid in pending_create_tool_ids:
                        pending_create_tool_ids.discard(tid)
                        if not obj.get("is_error") and rebound_project_id is None:
                            new_pid = _extract_project_id_from_result(
                                obj.get("content") or ""
                            )
                            if new_pid:
                                try:
                                    updated = await crud.update_chat_session(
                                        session_id, project_id=new_pid
                                    )
                                except Exception as e:
                                    logger.warning("auto-rebind UPDATE failed: %s", e)
                                    updated = None
                                if updated:
                                    rebound_project_id = new_pid
                                    yield json.dumps(
                                        {
                                            "type": "session_rebind",
                                            "session_id": session_id,
                                            "project_id": new_pid,
                                        }
                                    ) + "\n"
        finally:
            final_text = "".join(final_text_parts).strip()
            if final_text:
                try:
                    await crud.create_chat_message(
                        session_id=session_id,
                        project_id=rebound_project_id,
                        role="assistant",
                        content=final_text,
                    )
                except Exception as e:
                    logger.warning("failed to persist assistant message: %s", e)

    return StreamingResponse(gen(), media_type="application/x-ndjson")


@router.get("/chat/sessions")
async def list_sessions(project_id: Optional[str] = None) -> list[dict]:
    return await crud.list_chat_sessions(project_id=project_id)


@router.get("/chat/sessions/{sid}")
async def get_session(sid: str) -> dict:
    session = await crud.get_chat_session(sid)
    if not session:
        raise HTTPException(status_code=404, detail=f"session not found: {sid}")
    messages = await crud.list_chat_messages(sid)
    return {"session": session, "messages": messages}


@router.patch("/chat/sessions/{sid}")
async def patch_session(sid: str, body: RebindBody) -> dict:
    session = await crud.get_chat_session(sid)
    if not session:
        raise HTTPException(status_code=404, detail=f"session not found: {sid}")
    if body.project_id is not None:
        project = await crud.get_project(body.project_id)
        if not project:
            raise HTTPException(
                status_code=400, detail=f"project not found: {body.project_id}"
            )
    updated = await crud.update_chat_session(sid, project_id=body.project_id)
    return updated or session


@router.delete("/chat/sessions/{sid}")
async def delete_session(sid: str) -> dict:
    ok = await crud.delete_chat_session(sid)
    if not ok:
        raise HTTPException(status_code=404, detail=f"session not found: {sid}")
    return {"deleted": sid}


@router.get("/chat/sessions/{sid}/audit")
async def list_session_audit(sid: str) -> list[dict]:
    return await crud.list_tool_audit(sid)
