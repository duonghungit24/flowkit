// Helpers to pick scene media URLs irrespective of orientation.
// A video may be VERTICAL or HORIZONTAL; the corresponding columns are
// `vertical_*_url` vs `horizontal_*_url`. Prefer vertical when both exist.
import type { Scene } from '../../types'

// Locally-generated assets are stored as `file:///abs/path/output/<rel>`.
// Browsers block file:// from http:// pages, so rewrite to the agent's
// /files static mount (proxied by Vite to 127.0.0.1:8100/files).
function toServableUrl(url: string | null): string | null {
  if (!url) return url
  if (!url.startsWith('file://')) return url
  const m = url.match(/\/output\/(.+)$/)
  if (!m) return url
  return `/files/${m[1]}`
}

export function sceneVideoUrl(s: Scene): string | null {
  return toServableUrl(s.vertical_video_url || s.horizontal_video_url || null)
}

export function sceneImageUrl(s: Scene): string | null {
  return toServableUrl(s.vertical_image_url || s.horizontal_image_url || null)
}

export function sceneUpscaleUrl(s: Scene): string | null {
  return toServableUrl(s.vertical_upscale_url || s.horizontal_upscale_url || null)
}

// Best-quality playable URL (upscale > video).
export function scenePlayableUrl(s: Scene): string {
  return sceneUpscaleUrl(s) || sceneVideoUrl(s) || ''
}
