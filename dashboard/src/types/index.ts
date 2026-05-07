// Enums
export type RequestType = 'GENERATE_IMAGE' | 'REGENERATE_IMAGE' | 'EDIT_IMAGE' | 'GENERATE_VIDEO' | 'GENERATE_VIDEO_REFS' | 'UPSCALE_VIDEO' | 'GENERATE_CHARACTER_IMAGE' | 'REGENERATE_CHARACTER_IMAGE' | 'EDIT_CHARACTER_IMAGE'
export type StatusType = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
export type Orientation = 'VERTICAL' | 'HORIZONTAL'
export type ChainType = 'ROOT' | 'CONTINUATION' | 'INSERT'
export type EntityType = 'character' | 'location' | 'creature' | 'visual_asset' | 'generic_troop' | 'faction'
export type ProjectStatus = 'ACTIVE' | 'ARCHIVED' | 'DELETED'

// Models — match the Python models exactly
export interface Project {
  id: string
  name: string
  description: string | null
  story: string | null
  thumbnail_url: string | null
  language: string
  status: ProjectStatus
  user_paygate_tier: string | null
  material: string
  narrator_voice: string | null
  narrator_ref_audio: string | null
  created_at: string
  updated_at: string
}

export interface Character {
  id: string
  name: string
  entity_type: EntityType
  description: string | null
  image_prompt: string | null
  voice_description: string | null
  reference_image_url: string | null
  media_id: string | null
  created_at: string
  updated_at: string
}

export interface Video {
  id: string
  project_id: string
  title: string
  description: string | null
  display_order: number
  status: string
  vertical_url: string | null
  horizontal_url: string | null
  thumbnail_url: string | null
  duration: number | null
  resolution: string | null
  created_at: string
  updated_at: string
}

export interface Scene {
  id: string
  video_id: string
  display_order: number
  prompt: string | null
  image_prompt: string | null
  video_prompt: string | null
  character_names: string | null  // JSON string array
  parent_scene_id: string | null
  chain_type: ChainType
  source: string | null
  vertical_image_url: string | null
  vertical_image_media_id: string | null
  vertical_image_status: StatusType
  vertical_video_url: string | null
  vertical_video_media_id: string | null
  vertical_video_status: StatusType
  vertical_upscale_url: string | null
  vertical_upscale_media_id: string | null
  vertical_upscale_status: StatusType
  horizontal_image_url: string | null
  horizontal_image_media_id: string | null
  horizontal_image_status: StatusType
  horizontal_video_url: string | null
  horizontal_video_media_id: string | null
  horizontal_video_status: StatusType
  horizontal_upscale_url: string | null
  horizontal_upscale_media_id: string | null
  horizontal_upscale_status: StatusType
  narrator_text: string | null
  trim_start: number | null
  trim_end: number | null
  duration: number | null
  created_at: string
  updated_at: string
}

export interface Request {
  id: string
  project_id: string | null
  video_id: string | null
  scene_id: string | null
  character_id: string | null
  type: RequestType
  orientation: Orientation | null
  status: StatusType
  request_id: string | null
  media_id: string | null
  output_url: string | null
  error_message: string | null
  retry_count: number
  created_at: string
  updated_at: string
}

// WebSocket event
export interface WSEvent {
  type: string
  data: Record<string, unknown>
  timestamp: string
}

// ---- Chat ----

export interface ChatSession {
  id: string
  project_id: string | null
  title: string
  model: string
  created_at: string
  updated_at: string
}

export interface ChatMessageRecord {
  id: string
  session_id: string
  project_id: string | null
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  tool_calls: string | null
  created_at: string
}

export interface ToolCallDisplay {
  id: string
  name: string
  input: Record<string, unknown>
  result?: string
  isError?: boolean
}

export interface LibrarySkill {
  name: string
  usage: string
  description: string
  group: string
  stage: string
  tags: string[]
}

// Visual style material (mirrors agent/models/material.py:MaterialResponse).
// Note: despite the name, this is a style descriptor — not an uploaded file.
export interface Material {
  id: string
  name: string
  style_instruction: string
  negative_prompt: string | null
  scene_prefix: string | null
  lighting: string
  is_builtin: boolean
}

// NDJSON event types — match agent/services/llm_bridge.py
export type NdjsonEvent =
  | { type: 'session'; session_id: string }
  | { type: 'text'; delta: string }
  | {
      type: 'tool_use'
      id: string
      name: string
      input: Record<string, unknown>
    }
  | { type: 'tool_result'; id: string; content: string; is_error?: boolean }
  | { type: 'error'; content: string }
  | {
      type: 'session_rebind'
      session_id: string
      project_id: string
    }
  | {
      type: 'done'
      session_id: string
      final_text?: string
    }
