"""Chat router — POST /api/chat (NDJSON stream) + session CRUD endpoints."""
import json
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from agent.db import crud
from agent.services import skill_executor
from agent.services.llm_bridge import stream_chat

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
                if obj.get("type") == "text":
                    final_text_parts.append(obj.get("delta", ""))
                elif obj.get("type") == "done" and obj.get("final_text"):
                    final_text_parts = [obj["final_text"]]
        finally:
            final_text = "".join(final_text_parts).strip()
            if final_text:
                try:
                    await crud.create_chat_message(
                        session_id=session_id,
                        project_id=req.project_id,
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


@router.delete("/chat/sessions/{sid}")
async def delete_session(sid: str) -> dict:
    ok = await crud.delete_chat_session(sid)
    if not ok:
        raise HTTPException(status_code=404, detail=f"session not found: {sid}")
    return {"deleted": sid}


@router.get("/chat/sessions/{sid}/audit")
async def list_session_audit(sid: str) -> list[dict]:
    return await crud.list_tool_audit(sid)
