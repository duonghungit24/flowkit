// NDJSON streaming chat client + session/skills REST.
// No new deps — native fetch + ReadableStream + TextDecoder.
import { fetchAPI } from './client'
import type {
  ChatMessageRecord,
  ChatSession,
  LibrarySkill,
  NdjsonEvent,
} from '../types'

interface StreamChatArgs {
  messages: { role: string; content: string }[]
  projectId: string | null
  sessionId: string | null
  model?: string
  autoApproveMutations?: boolean
  signal?: AbortSignal
}

export async function* streamChat(
  args: StreamChatArgs,
): AsyncGenerator<NdjsonEvent> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: args.signal,
    body: JSON.stringify({
      messages: args.messages,
      project_id: args.projectId,
      session_id: args.sessionId,
      model: args.model,
      auto_approve_mutations: args.autoApproveMutations ?? false,
    }),
  })
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`chat ${res.status}: ${text}`)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const raw of lines) {
      const line = raw.trim()
      if (!line) continue
      try {
        yield JSON.parse(line) as NdjsonEvent
      } catch {
        // skip malformed line
      }
    }
  }
  const tail = buf.trim()
  if (tail) {
    try {
      yield JSON.parse(tail) as NdjsonEvent
    } catch {
      /* noop */
    }
  }
}

export function listSessions(projectId: string | null): Promise<ChatSession[]> {
  const qs = projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''
  return fetchAPI<ChatSession[]>(`/api/chat/sessions${qs}`)
}

export function getSession(
  sid: string,
): Promise<{ session: ChatSession; messages: ChatMessageRecord[] }> {
  return fetchAPI(`/api/chat/sessions/${sid}`)
}

export function deleteSession(sid: string): Promise<{ deleted: string }> {
  return fetchAPI(`/api/chat/sessions/${sid}`, { method: 'DELETE' })
}

export function confirmToolCall(args: {
  toolCallId: string
  approved: boolean
  sessionId?: string | null
}): Promise<{ ok: boolean; tool_call_id: string; approved: boolean }> {
  return fetchAPI('/api/chat/confirm', {
    method: 'POST',
    body: JSON.stringify({
      tool_call_id: args.toolCallId,
      approved: args.approved,
      session_id: args.sessionId ?? null,
    }),
  })
}

export interface ToolAuditEntry {
  id: string
  session_id: string
  message_id: string | null
  method: string
  path: string
  body_summary: string | null
  status: 'auto' | 'approved' | 'rejected'
  created_at: string
}

export function listSessionAudit(sid: string): Promise<ToolAuditEntry[]> {
  return fetchAPI<ToolAuditEntry[]>(`/api/chat/sessions/${sid}/audit`)
}

let _skillsCache: LibrarySkill[] | null = null
let _skillsPromise: Promise<LibrarySkill[]> | null = null

export function listSkills(refresh = false): Promise<LibrarySkill[]> {
  if (!refresh && _skillsCache) return Promise.resolve(_skillsCache)
  if (_skillsPromise) return _skillsPromise
  _skillsPromise = fetchAPI<LibrarySkill[]>(
    `/api/library-skills${refresh ? '?refresh=true' : ''}`,
  )
    .then(s => {
      _skillsCache = s
      return s
    })
    .finally(() => {
      _skillsPromise = null
    })
  return _skillsPromise
}
