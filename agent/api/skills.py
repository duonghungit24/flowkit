"""GET /api/library-skills — list all FlowKit skill recipes for the dashboard."""
from fastapi import APIRouter

from agent.services import skill_executor

router = APIRouter(tags=["skills"])


@router.get("/library-skills")
async def list_library_skills(refresh: bool = False) -> list[dict]:
    """Scan skills/fk-*.md and return [{name, usage, description, group}]."""
    return skill_executor.list_skills(refresh=refresh)
