"""LLM bridge — Claude CLI subprocess wrapper for chat with manual tool loop.

Claude Code's `--print` mode does not expose custom-tool calling, so we run a
manual parse-and-execute loop:

  1. Format chat history into a single prompt.
  2. Spawn `claude --print --output-format stream-json --append-system-prompt ...`.
  3. Stream `text` deltas back to the caller as NDJSON `text` events.
  4. On round end, parse the assistant's text for a fenced ```flowkit ...``` block.
  5. If found, execute via tool_executor, emit tool_call/tool_result events,
     append both to history, and start another round (max 15).
  6. Otherwise emit `done`.
"""
import asyncio
import json
import logging
import re
import shutil
import uuid
from pathlib import Path
from typing import AsyncIterator, Optional

from agent.config import BASE_DIR
from agent.services import skill_executor
from agent.services.tool_executor import (
    FLOWKIT_TOOLS,
    execute_tool_call,
    needs_confirmation,
)

logger = logging.getLogger(__name__)

MAX_ROUNDS = 15
_FENCE_RE = re.compile(r"```flowkit\s*\n(.*?)\n```", re.DOTALL | re.IGNORECASE)
_SYSTEM_PROMPT_CACHE: Optional[str] = None


def _read_optional(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8") if path.is_file() else ""
    except OSError as e:
        logger.warning("could not read %s: %s", path, e)
        return ""


def build_system_prompt(refresh: bool = False) -> str:
    """Compose the system prompt: identity + tool spec + skill index + repo CLAUDE.md.

    Cached after first call (skill list + CLAUDE.md don't change inside one
    process); pass refresh=True to invalidate.
    """
    global _SYSTEM_PROMPT_CACHE
    if _SYSTEM_PROMPT_CACHE is not None and not refresh:
        return _SYSTEM_PROMPT_CACHE

    skills = skill_executor.list_skills(refresh=refresh)
    skill_lines = [f"- /{s['name']}  ({s['group']}) — {s['description']}" for s in skills]
    skill_block = "\n".join(skill_lines) if skill_lines else "(no skills loaded)"

    tool_block = json.dumps(FLOWKIT_TOOLS, indent=2)

    claude_md = _read_optional(BASE_DIR / "CLAUDE.md")
    agents_md = _read_optional(BASE_DIR / "AGENTS.md")
    repo_context = claude_md or agents_md or ""
    repo_section = (
        f"\n--- BEGIN REPO CONTEXT (CLAUDE.md / AGENTS.md) ---\n"
        f"{repo_context.strip()[:6000]}\n"
        f"--- END REPO CONTEXT ---\n"
    ) if repo_context else ""

    prompt = f"""You are the FlowKit AI assistant. The user is interacting via a browser chat
panel attached to a local FlowKit agent on http://127.0.0.1:8100.

To call the FlowKit REST API, emit EXACTLY ONE fenced code block in this form
and STOP your turn (do not continue writing after the block):

```flowkit
{{"method": "GET", "path": "/api/projects"}}
```

I (the harness) will execute the call and reply with a tool_result message
containing {{"status": <int>, "body": <json>}}. You may then continue with
analysis or another tool call. Keep tool calls focused — one per turn.

Tool spec:
{tool_block}

Rules:
- Always use the flowkit_api tool for FlowKit data — never invent endpoint
  responses.
- For mutating calls (PATCH/DELETE), explain the action plainly first; the
  harness may require user confirmation.
- Prefer concise answers. Show tabular data as compact markdown tables.

Available skills (workflow recipes — invoke them yourself by reading the
matching skill file when the user's intent matches; users can also type
/fk-<name> directly):
{skill_block}
{repo_section}"""

    _SYSTEM_PROMPT_CACHE = prompt
    return prompt


def _format_history(messages: list[dict]) -> str:
    """Serialise a chat history list into a single prompt string for claude --print."""
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
    parts.append("[ASSISTANT]\n")  # cue the model to respond
    return "\n\n".join(parts)


def _parse_tool_call(text: str) -> Optional[dict]:
    """Pull the first ```flowkit {...}``` block from the assistant text, if any."""
    m = _FENCE_RE.search(text or "")
    if not m:
        return None
    raw = m.group(1).strip()
    try:
        obj = json.loads(raw)
    except json.JSONDecodeError as e:
        logger.warning("flowkit fence not valid JSON: %s", e)
        return None
    if not isinstance(obj, dict) or "method" not in obj or "path" not in obj:
        return None
    return obj


def _ndjson(event: dict) -> str:
    return json.dumps(event, ensure_ascii=False) + "\n"


def _claude_available() -> bool:
    return shutil.which("claude") is not None


async def _run_claude_round(prompt: str, system_prompt: str) -> AsyncIterator[tuple[str, str]]:
    """Spawn one claude --print invocation, yield ('text', delta) tuples + final ('full', text).

    Uses --output-format stream-json so we can stream incremental assistant
    deltas back to the browser before the round finishes.
    """
    args = [
        "claude", "--print",
        "--output-format", "stream-json",
        "--verbose",  # required by claude CLI when stream-json output is used
        "--append-system-prompt", system_prompt,
        "--allowedTools", "",  # no built-in tools; we drive tool calls manually
        "--include-partial-messages",
        prompt,
    ]
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    full_text = ""
    assert proc.stdout is not None
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
            # Anthropic streaming partials: content_block_delta with text_delta
            ev = event.get("event", {})
            if ev.get("type") == "content_block_delta":
                delta = ev.get("delta", {})
                if delta.get("type") == "text_delta":
                    txt = delta.get("text", "")
                    if txt:
                        full_text += txt
                        yield ("text", txt)
        elif etype == "assistant":
            # Full assistant message landed; if we already streamed deltas, skip.
            if not full_text:
                msg = event.get("message", {})
                for block in msg.get("content", []) or []:
                    if block.get("type") == "text":
                        txt = block.get("text", "")
                        if txt:
                            full_text += txt
                            yield ("text", txt)
        elif etype == "result":
            if event.get("subtype") and event.get("subtype") != "success":
                err = event.get("result") or event.get("error") or "claude CLI returned non-success"
                yield ("error", str(err))
    rc = await proc.wait()
    if rc != 0:
        stderr = (await proc.stderr.read()).decode("utf-8", errors="replace") if proc.stderr else ""
        yield ("error", f"claude exited rc={rc}: {stderr[-400:]}")
    yield ("full", full_text)


async def stream_chat(
    messages: list[dict],
    *,
    session_id: str,
    project_id: Optional[str] = None,
    extra_system: Optional[str] = None,
    auto_approve_mutations: bool = False,
) -> AsyncIterator[str]:
    """Drive the manual tool loop and yield NDJSON-encoded events as strings."""
    if not _claude_available():
        yield _ndjson({"type": "error", "content": "claude CLI not found on PATH"})
        yield _ndjson({"type": "done", "session_id": session_id})
        return

    system_prompt = build_system_prompt()
    if extra_system:
        system_prompt = f"{system_prompt}\n\n{extra_system}"
    if project_id:
        system_prompt += f"\n\nActive project_id: {project_id}"

    history = list(messages)
    yield _ndjson({"type": "session", "session_id": session_id})

    final_assistant_text = ""

    for round_num in range(MAX_ROUNDS):
        prompt = _format_history(history)
        round_text = ""
        had_error = False
        async for kind, payload in _run_claude_round(prompt, system_prompt):
            if kind == "text":
                yield _ndjson({"type": "text", "delta": payload})
            elif kind == "error":
                yield _ndjson({"type": "error", "content": payload})
                had_error = True
            elif kind == "full":
                round_text = payload

        if had_error and not round_text:
            break

        history.append({"role": "assistant", "content": round_text})
        final_assistant_text = round_text

        tc = _parse_tool_call(round_text)
        if not tc:
            break

        tc_id = f"tc_{uuid.uuid4().hex[:8]}"
        method = (tc.get("method") or "GET").upper()
        path = tc.get("path") or "/"
        body = tc.get("body")

        yield _ndjson({
            "type": "tool_call",
            "id": tc_id,
            "name": "flowkit_api",
            "args": {"method": method, "path": path, "body": body},
        })

        # PATCH/DELETE/PUT suspend in tool_executor on an asyncio Future. Emit
        # the confirm_required event first so the browser renders the modal,
        # then await the executor (which will block until the user posts to
        # /api/chat/confirm or the timeout fires).
        if needs_confirmation(method, auto_approve_mutations):
            yield _ndjson({
                "type": "confirm_required",
                "id": tc_id,
                "method": method,
                "path": path,
                "body": body,
            })

        try:
            result = await execute_tool_call(
                method, path, body,
                session_id=session_id,
                tool_call_id=tc_id,
                auto_approve_mutations=auto_approve_mutations,
            )
            result_str = json.dumps(result, ensure_ascii=False)
        except Exception as e:
            logger.exception("tool execution failed")
            result_str = json.dumps({"status": 500, "body": {"error": str(e)}})

        yield _ndjson({"type": "tool_result", "id": tc_id, "content": result_str})
        history.append({"role": "tool", "content": f"tool_result(id={tc_id}):\n{result_str}"})
    else:
        yield _ndjson({"type": "error", "content": f"max rounds reached ({MAX_ROUNDS})"})

    yield _ndjson({
        "type": "done",
        "session_id": session_id,
        "final_text": final_assistant_text,
    })
