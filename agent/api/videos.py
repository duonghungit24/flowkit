from fastapi import APIRouter, HTTPException
from agent.models.video import Video, VideoCreate, VideoUpdate
from agent.sdk.persistence.sqlite_repository import SQLiteRepository
from agent.utils.paths import project_dir
from agent.utils.slugify import slugify
from dataclasses import asdict

router = APIRouter(prefix="/videos", tags=["videos"])

_repo = SQLiteRepository()


def _video_to_flat(sdk_video) -> dict:
    """Convert SDK Video domain model to flat dict matching API response shape."""
    return {
        "id": sdk_video.id,
        "project_id": sdk_video.project_id,
        "title": sdk_video.title,
        "description": sdk_video.description,
        "display_order": sdk_video.display_order,
        "status": sdk_video.status,
        "orientation": sdk_video.orientation,
        "vertical_url": sdk_video.vertical_url,
        "horizontal_url": sdk_video.horizontal_url,
        "thumbnail_url": sdk_video.thumbnail_url,
        "duration": sdk_video.duration,
        "resolution": sdk_video.resolution,
        "youtube_id": sdk_video.youtube_id,
        "privacy": sdk_video.privacy,
        "tags": sdk_video.tags,
        "created_at": sdk_video.created_at,
        "updated_at": sdk_video.updated_at,
    }


@router.post("", response_model=Video)
async def create(body: VideoCreate):
    sdk_video = await _repo.create_video(**body.model_dump(exclude_none=True))
    return _video_to_flat(sdk_video)


@router.get("", response_model=list[Video])
async def list_by_project(project_id: str):
    videos = await _repo.list_videos(project_id)
    return [_video_to_flat(v) for v in videos]


@router.get("/{vid}", response_model=Video)
async def get(vid: str):
    sdk_video = await _repo.get_video(vid)
    if not sdk_video:
        raise HTTPException(404, "Video not found")
    return _video_to_flat(sdk_video)


@router.patch("/{vid}", response_model=Video)
async def update(vid: str, body: VideoUpdate):
    row = await _repo.update("video", vid, **body.model_dump(exclude_unset=True))
    if not row:
        raise HTTPException(404, "Video not found")
    sdk_video = _repo._row_to_video(row)
    return _video_to_flat(sdk_video)


@router.delete("/{vid}")
async def delete(vid: str):
    if not await _repo.delete("video", vid):
        raise HTTPException(404, "Video not found")
    return {"ok": True}


@router.get("/{vid}/final")
async def get_final(vid: str):
    """Resolve finalized assets for a video.

    Looks under `output/<project_slug>/` for the master MP4, thumbnails,
    and youtube_metadata.md produced by /fk-concat / /fk-finalize.
    Returns servable /files paths (via the StaticFiles mount in main.py).
    """
    sdk_video = await _repo.get_video(vid)
    if not sdk_video:
        raise HTTPException(404, "Video not found")
    project = await _repo.get("project", sdk_video.project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    slug = slugify(project["name"])
    pdir = project_dir(slug)

    def _files_url(p):
        return f"/files/{p.relative_to(pdir.parent).as_posix()}"

    master = pdir / f"{slug}_master.mp4"
    master_info = None
    if master.exists():
        master_info = {"url": _files_url(master), "size": master.stat().st_size}

    thumbs_dir = pdir / "thumbnails"
    thumbnails = []
    if thumbs_dir.exists():
        thumbnails = sorted(_files_url(p) for p in thumbs_dir.glob("*.png"))
        thumbnails += sorted(_files_url(p) for p in thumbs_dir.glob("*.jpg"))

    metadata = pdir / "youtube_metadata.md"
    metadata_url = _files_url(metadata) if metadata.exists() else None

    return {
        "project_slug": slug,
        "master": master_info,
        "thumbnails": thumbnails,
        "youtube_metadata_url": metadata_url,
        "youtube_id": sdk_video.youtube_id,
        "stored_url": sdk_video.horizontal_url or sdk_video.vertical_url,
    }
