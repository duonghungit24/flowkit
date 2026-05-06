"""Skill executor — detect, list, and load FlowKit skill files (skills/fk-*.md).

A "skill" is a markdown workflow doc consumed by AI agents. When a chat user
types `/fk-status <args>`, the chat router intercepts via `detect_skill_command`
and injects the skill content as system context for the LLM round.
"""
import logging
import re
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# skills/ lives at repo root (two parents up from this file's package).
SKILLS_DIR = Path(__file__).resolve().parent.parent.parent / "skills"

# Match `/fk-<name>` at the start; capture name + remaining args.
_SKILL_RE = re.compile(r"^/fk-([\w-]+)\s*(.*)$", re.IGNORECASE | re.DOTALL)

_SKILL_CACHE: Optional[list[dict]] = None


def detect_skill_command(text: str) -> Optional[tuple[str, str]]:
    """Return (skill_name, args) if text starts with /fk-<name>, else None."""
    if not text:
        return None
    m = _SKILL_RE.match(text.strip())
    if not m:
        return None
    return m.group(1), m.group(2).strip()


def _infer_stage(slug: str) -> str:
    """Map skill slug to pipeline stage for Library grouping.

    Stages: setup, generation, audio, post-process, qa-review, utility.
    Order of checks is important — first match wins.
    """
    if slug.startswith(("create-", "add-", "import-", "switch-", "change-")):
        return "setup"
    if (
        slug.startswith(("tts-", "music-", "narrator"))
        or slug.startswith(("gen-music", "gen-tts", "gen-narrator"))
        or slug == "concat-fit-narrator"
    ):
        return "audio"
    if slug.startswith(("review-", "doctor")):
        return "qa-review"
    if slug.startswith(("concat", "upscale", "pipeline", "fix-", "refresh-")):
        return "post-process"
    if slug.startswith(("gen-", "thumbnail", "brand", "creative-")):
        return "generation"
    return "utility"


def _parse_tags(md_text: str) -> list[str]:
    """Best-effort `tags: a, b, c` line scan within the first 12 non-empty lines."""
    lines = [ln.strip() for ln in md_text.splitlines() if ln.strip()][:12]
    for ln in lines:
        if ln.lower().startswith("tags:"):
            raw = ln.split(":", 1)[1]
            raw = raw.strip().strip("[]")
            return [t.strip().strip("`\"'") for t in raw.split(",") if t.strip()]
    return []


def _parse_metadata(md_text: str, slug: str) -> dict:
    """Pull a one-line summary from the first non-empty markdown line.

    Skill files have no fixed front-matter; the convention is line 1 = summary,
    optional `Usage: ...` line follows. Group is derived from slug prefix; stage
    is the pipeline-level grouping used by the dashboard Library page.
    """
    lines = [ln.strip() for ln in md_text.splitlines() if ln.strip()]
    description = lines[0] if lines else ""
    description = re.sub(r"^#+\s*", "", description).strip()

    usage = ""
    for ln in lines[:8]:
        if ln.lower().startswith("usage:"):
            usage = ln.split(":", 1)[1].strip().strip("`")
            break
    if not usage:
        usage = f"/fk-{slug}"

    # Derive a coarse group from the slug's first verb-ish token.
    head = slug.split("-", 1)[0]
    group_map = {
        "create": "project",
        "switch": "project",
        "status": "project",
        "dashboard": "project",
        "gen": "generate",
        "review": "review",
        "thumbnail": "media",
        "concat": "media",
        "import": "media",
        "upload": "media",
        "youtube": "publish",
        "doctor": "ops",
        "monitor": "ops",
        "fix": "ops",
        "refresh": "ops",
        "research": "planning",
        "pipeline": "planning",
        "creative": "planning",
        "camera": "guide",
        "thumbnail_guide": "guide",
        "brand": "guide",
        "change": "config",
        "add": "config",
        "insert": "edit",
    }
    group = group_map.get(head, "misc")
    return {
        "name": f"fk-{slug}",
        "usage": usage,
        "description": description,
        "group": group,
        "stage": _infer_stage(slug),
        "tags": _parse_tags(md_text),
    }


def list_skills(refresh: bool = False) -> list[dict]:
    """Scan skills/fk-*.md → return [{name, usage, description, group}]."""
    global _SKILL_CACHE
    if _SKILL_CACHE is not None and not refresh:
        return _SKILL_CACHE

    if not SKILLS_DIR.is_dir():
        logger.warning("skills directory missing: %s", SKILLS_DIR)
        _SKILL_CACHE = []
        return _SKILL_CACHE

    out: list[dict] = []
    for p in sorted(SKILLS_DIR.glob("fk-*.md")):
        slug = p.stem.removeprefix("fk-")
        try:
            text = p.read_text(encoding="utf-8")
        except OSError as e:
            logger.warning("could not read skill %s: %s", p.name, e)
            continue
        out.append(_parse_metadata(text, slug))

    _SKILL_CACHE = out
    return out


def get_skill_content(name: str) -> Optional[str]:
    """Return the raw markdown of skills/fk-<name>.md, or None if missing."""
    slug = name.removeprefix("fk-")
    path = SKILLS_DIR / f"fk-{slug}.md"
    if not path.is_file():
        return None
    try:
        return path.read_text(encoding="utf-8")
    except OSError as e:
        logger.warning("could not read skill %s: %s", path.name, e)
        return None


def execute_skill(name: str, args: str) -> Optional[str]:
    """Return a system-context block that injects the skill body + invocation args.

    The chat router prepends this to the LLM round's system prompt so the model
    has the full workflow recipe before responding.
    """
    body = get_skill_content(name)
    if body is None:
        return None
    arg_block = f"\nInvocation args: {args}\n" if args else ""
    return (
        f"--- BEGIN SKILL: fk-{name.removeprefix('fk-')} ---\n"
        f"{body.strip()}\n"
        f"{arg_block}"
        f"--- END SKILL ---\n"
    )
