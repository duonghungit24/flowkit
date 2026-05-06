"""LLM bridge — Claude CLI subprocess wrapper for chat (native-tools mode).

Spawns `claude --print --output-format stream-json --dangerously-skip-permissions`
and relays its stream-json events to the browser as NDJSON. Claude Code drives
the tool loop natively (Bash, Read, Edit, Glob, Grep, etc.) — same execution
model as a terminal Claude Code session, just with the chat panel as I/O.

Skills are injected as system context so `/fk-<name>` works the same way the
terminal slash command does.
"""
import asyncio
import json
import logging
import shutil
from pathlib import Path
from typing import AsyncIterator, Optional

from agent.config import BASE_DIR
from agent.services import skill_executor

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT_CACHE: Optional[str] = None


def _read_optional(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8") if path.is_file() else ""
    except OSError as e:
        logger.warning("could not read %s: %s", path, e)
        return ""


def build_system_prompt(refresh: bool = False) -> str:
    """Compose the system prompt: identity + skill index + repo CLAUDE.md.

    Cached after first call; pass refresh=True to invalidate.
    """
    global _SYSTEM_PROMPT_CACHE
    if _SYSTEM_PROMPT_CACHE is not None and not refresh:
        return _SYSTEM_PROMPT_CACHE

    skills = skill_executor.list_skills(refresh=refresh)
    skill_lines = [f"- /{s['name']}  ({s['group']}) — {s['description']}" for s in skills]
    skill_block = "\n".join(skill_lines) if skill_lines else "(no skills loaded)"

    claude_md = _read_optional(BASE_DIR / "CLAUDE.md")
    agents_md = _read_optional(BASE_DIR / "AGENTS.md")
    repo_context = claude_md or agents_md or ""
    repo_section = (
        f"\n--- BEGIN REPO CONTEXT (CLAUDE.md / AGENTS.md) ---\n"
        f"{repo_context.strip()[:8000]}\n"
        f"--- END REPO CONTEXT ---\n"
    ) if repo_context else ""

    prompt = f"""You are the FlowKit AI assistant running inside a browser chat panel
attached to the local FlowKit agent on http://127.0.0.1:8100.

You have full Claude Code tool access (Bash, Read, Edit, Glob, Grep, Write).
The working directory is the FlowKit repo root, so curl/jq/ffmpeg/python and
all `skills/fk-*.md` recipes work exactly as in a terminal session.

Available skills (workflow recipes — when the user types /fk-<name>, the body
of the matching skill file will be appended to your context; follow it):
{skill_block}
{repo_section}"""

    _SYSTEM_PROMPT_CACHE = prompt
    return prompt


def _format_history(messages: list[dict]) -> str:
    """Serialise chat history into a single prompt for `claude --print`."""
    parts: list[str] = []
    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if role == "system":
            parts.append(f"[SYSTEM]\n{content}")
        elif role == "user":
            parts.append(f"[USER]\n{content}")
        elif role == "assistant":
            parts.append(f"[ASSISTANT]\n{content}")
        elif role == "tool":
            parts.append(f"[TOOL_RESULT]\n{content}")
    parts.append("[ASSISTANT]\n")  # cue model to respond
    return "\n\n".join(parts)


def _ndjson(event: dict) -> str:
    return json.dumps(event, ensure_ascii=False) + "\n"


def _claude_available() -> bool:
    return shutil.which("claude") is not None


def _content_blocks(message: dict) -> list[dict]:
    blocks = message.get("content")
    if isinstance(blocks, list):
        return blocks
    return []


def _tool_result_text(block: dict) -> tuple[str, bool]:
    """Extract a string preview + error flag from a tool_result content block."""
    is_error = bool(block.get("is_error"))
    content = block.get("content")
    if isinstance(content, str):
        return content, is_error
    if isinstance(content, list):
        # Anthropic spec: list of {type:"text"|"image", ...}
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict):
                if item.get("type") == "text":
                    parts.append(str(item.get("text", "")))
                else:
                    parts.append(json.dumps(item, ensure_ascii=False))
            else:
                parts.append(str(item))
        return "\n".join(parts), is_error
    return json.dumps(content, ensure_ascii=False) if content is not None else "", is_error


async def stream_chat(
    messages: list[dict],
    *,
    session_id: str,
    project_id: Optional[str] = None,
    extra_system: Optional[str] = None,
) -> AsyncIterator[str]:
    """Spawn `claude --print` once per user turn and relay events to the browser.

    Yields NDJSON-encoded lines. Event types:
      - session       {session_id}
      - text          {delta}
      - tool_use      {id, name, input}
      - tool_result   {id, content, is_error}
      - error         {content}
      - done          {session_id, final_text}
    """
    if not _claude_available():
        yield _ndjson({"type": "error", "content": "claude CLI not found on PATH"})
        yield _ndjson({"type": "done", "session_id": session_id})
        return

    system_prompt = build_system_prompt()
    if extra_system:
        system_prompt = f"{system_prompt}\n\n{extra_system}"
    if project_id:
        system_prompt += f"\n\nActive project_id: {project_id}"

    yield _ndjson({"type": "session", "session_id": session_id})

    args = [
        "claude", "--print",
        "--output-format", "stream-json",
        "--verbose",  # required when using stream-json
        "--include-partial-messages",
        "--dangerously-skip-permissions",  # local-only chat = same risk profile as terminal
        "--append-system-prompt", system_prompt,
        _format_history(messages),
    ]

    try:
        proc = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(BASE_DIR),
        )
    except Exception as e:
        yield _ndjson({"type": "error", "content": f"failed to spawn claude: {e}"})
        yield _ndjson({"type": "done", "session_id": session_id})
        return

    final_text_parts: list[str] = []
    seen_tool_ids: set[str] = set()
    assert proc.stdout is not None

    try:
        while True:
            line = await proc.stdout.readline()
            if not line:
                break
            try:
                event = json.loads(line.decode("utf-8", errors="replace"))
            except json.JSONDecodeError:
                continue

            etype = event.get("type")

            if etype == "stream_event":
                ev = event.get("event", {})
                if ev.get("type") == "content_block_delta":
                    delta = ev.get("delta", {})
                    if delta.get("type") == "text_delta":
                        txt = delta.get("text", "")
                        if txt:
                            final_text_parts.append(txt)
                            yield _ndjson({"type": "text", "delta": txt})

            elif etype == "assistant":
                # Full assistant message — pull tool_use blocks (input is now complete).
                msg = event.get("message", {})
                for block in _content_blocks(msg):
                    btype = block.get("type")
                    if btype == "tool_use":
                        tool_id = block.get("id") or ""
                        if tool_id in seen_tool_ids:
                            continue
                        seen_tool_ids.add(tool_id)
                        yield _ndjson({
                            "type": "tool_use",
                            "id": tool_id,
                            "name": block.get("name") or "",
                            "input": block.get("input") or {},
                        })

            elif etype == "user":
                # Tool results come back as user messages.
                msg = event.get("message", {})
                for block in _content_blocks(msg):
                    if block.get("type") == "tool_result":
                        text, is_error = _tool_result_text(block)
                        yield _ndjson({
                            "type": "tool_result",
                            "id": block.get("tool_use_id") or "",
                            "content": text,
                            "is_error": is_error,
                        })

            elif etype == "result":
                if event.get("subtype") and event.get("subtype") != "success":
                    err = event.get("result") or event.get("error") or "claude returned non-success"
                    yield _ndjson({"type": "error", "content": str(err)})

        rc = await proc.wait()
        if rc != 0:
            stderr = (await proc.stderr.read()).decode("utf-8", errors="replace") if proc.stderr else ""
            yield _ndjson({"type": "error", "content": f"claude exited rc={rc}: {stderr[-400:]}"})
    finally:
        if proc.returncode is None:
            try:
                proc.terminate()
            except ProcessLookupError:
                pass

    yield _ndjson({
        "type": "done",
        "session_id": session_id,
        "final_text": "".join(final_text_parts).strip(),
    })
