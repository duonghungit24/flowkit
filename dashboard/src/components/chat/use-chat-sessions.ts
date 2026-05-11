// Manages chat session list + active selection + draft-scoped localStorage.
// localStorage key uses `draft` for project_id=null so draft sessions persist
// across reload independently from per-project sessions.
import { useCallback, useEffect, useRef, useState } from 'react'
import { deleteSession, getSession, listSessions } from '../../api/chat-api'
import type { ChatMessageRecord, ChatSession } from '../../types'

const lsKey = (projectId: string | null) =>
  `fk-chat-session:${projectId ?? 'draft'}`

export interface UseChatSessions {
  sessions: ChatSession[]
  activeId: string | null
  setActiveId: (sid: string | null) => void
  refresh: () => Promise<ChatSession[]>
  load: (sid: string) => Promise<ChatMessageRecord[]>
  remove: (sid: string) => Promise<void>
  reset: () => void
  error: string | null
}

export function useChatSessions(projectId: string | null): UseChatSessions {
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeId, setActiveIdState] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Track latest activeId without re-running the project-change effect.
  const activeIdRef = useRef<string | null>(null)
  useEffect(() => {
    activeIdRef.current = activeId
  }, [activeId])

  const refresh = useCallback(async () => {
    const list = await listSessions(projectId)
    setSessions(list)
    return list
  }, [projectId])

  const setActiveId = useCallback(
    (sid: string | null) => {
      setActiveIdState(sid)
      if (sid) localStorage.setItem(lsKey(projectId), sid)
      else localStorage.removeItem(lsKey(projectId))
    },
    [projectId],
  )

  const load = useCallback(
    async (sid: string) => {
      setActiveId(sid)
      try {
        const { messages } = await getSession(sid)
        return messages
      } catch (e) {
        setError(String(e))
        return []
      }
    },
    [setActiveId],
  )

  const remove = useCallback(
    async (sid: string) => {
      try {
        await deleteSession(sid)
        if (activeId === sid) setActiveId(null)
        await refresh()
      } catch (e) {
        setError(String(e))
      }
    },
    [activeId, refresh, setActiveId],
  )

  const reset = useCallback(() => {
    setActiveId(null)
  }, [setActiveId])

  // Initial load on project change: fetch list + restore last session if it still exists.
  // Auto-rebind path: when the panel stays mounted and projectId flips from
  // null → newPid, the session that triggered the rebind is still active in
  // memory. Carry it over so the transcript doesn't blank out.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const list = await refresh()
        if (cancelled) return
        const carry = activeIdRef.current
        const carriedExists = carry ? list.find(s => s.id === carry) : null
        if (carriedExists) {
          try {
            localStorage.setItem(lsKey(projectId), carriedExists.id)
          } catch {
            /* ignore */
          }
          // No state change needed — activeId already points at this session.
          return
        }
        const remembered = localStorage.getItem(lsKey(projectId))
        const exists = list.find(s => s.id === remembered)
        if (exists) {
          setActiveIdState(exists.id)
        } else {
          setActiveIdState(null)
        }
      } catch (e) {
        if (!cancelled) setError(String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, refresh])

  return { sessions, activeId, setActiveId, refresh, load, remove, reset, error }
}
