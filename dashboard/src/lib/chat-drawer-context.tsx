// Chat drawer state — survives navigation because it lives at the App layout
// level outside <Routes>. Persists open + active project to localStorage so
// the drawer reopens on reload exactly where the user left off.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { fetchAPI } from '../api/client'
import type { Project } from '../types'

const LS_OPEN = 'fk-chat-drawer-open'
const LS_ACTIVE_PROJECT = 'fk-chat-drawer-project'

interface ChatDrawerContextValue {
  open: boolean
  setOpen: (v: boolean) => void
  toggle: () => void
  activeProjectId: string | null
  // User-initiated project switch (picker, openWith). Bumps panelResetKey so
  // the chat panel fully remounts and starts a fresh draft view.
  setActiveProjectId: (pid: string | null) => void
  // Auto-rebind path: backend created a project mid-stream. Switches scope
  // WITHOUT bumping panelResetKey so the live transcript + active session id
  // survive the project change.
  rebindActiveProjectId: (pid: string) => void
  // Re-mount key for ChatPanel. Only changes on manual switches.
  panelResetKey: number
  // Convenience: open drawer pre-bound to a specific project (or draft when null).
  // Optional initialInput pre-fills the chat input (used by SkillsTab "Run in chat").
  openWith: (projectId: string | null, initialInput?: string) => void
  pendingInput: string | null
  consumePendingInput: () => void
  projects: Project[]
  refreshProjects: () => Promise<void>
  // Notice last auto-rebind so the picker can flash a brief banner.
  rebindNotice: { projectId: string; at: number } | null
  notifyRebind: (pid: string) => void
  // Increments after every chat turn completes; pages bound to the active
  // project subscribe so they can refresh data the chat may have mutated.
  turnTick: number
  notifyTurnComplete: () => void
}

const Ctx = createContext<ChatDrawerContextValue | null>(null)

function readBool(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function readActive(): string | null {
  try {
    const v = localStorage.getItem(LS_ACTIVE_PROJECT)
    return v && v !== 'null' ? v : null
  } catch {
    return null
  }
}

export function ChatDrawerProvider({ children }: { children: ReactNode }) {
  const [open, setOpenState] = useState<boolean>(() => readBool(LS_OPEN))
  const [activeProjectId, setActiveProjectIdState] = useState<string | null>(() => readActive())
  const [panelResetKey, setPanelResetKey] = useState<number>(0)
  const [projects, setProjects] = useState<Project[]>([])
  const [rebindNotice, setRebindNotice] = useState<{ projectId: string; at: number } | null>(null)
  const [pendingInput, setPendingInput] = useState<string | null>(null)
  const [turnTick, setTurnTick] = useState(0)

  const consumePendingInput = useCallback(() => setPendingInput(null), [])
  const notifyTurnComplete = useCallback(() => setTurnTick(n => n + 1), [])

  const refreshProjects = useCallback(async () => {
    try {
      const list = await fetchAPI<Project[]>('/api/projects')
      // Sort by updated_at desc, fall back to created_at if missing.
      list.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
      setProjects(list)
    } catch (e) {
      console.warn('chat drawer: failed to load projects', e)
    }
  }, [])

  const notifyRebind = useCallback((pid: string) => {
    setRebindNotice({ projectId: pid, at: Date.now() })
  }, [])

  const setOpen = useCallback((v: boolean) => {
    setOpenState(v)
    try {
      localStorage.setItem(LS_OPEN, v ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [])

  const setActiveProjectId = useCallback((pid: string | null) => {
    setActiveProjectIdState(pid)
    setPanelResetKey(k => k + 1)
    try {
      if (pid) localStorage.setItem(LS_ACTIVE_PROJECT, pid)
      else localStorage.removeItem(LS_ACTIVE_PROJECT)
    } catch {
      /* ignore */
    }
  }, [])

  const rebindActiveProjectId = useCallback((pid: string) => {
    setActiveProjectIdState(pid)
    try {
      localStorage.setItem(LS_ACTIVE_PROJECT, pid)
    } catch {
      /* ignore */
    }
  }, [])

  const toggle = useCallback(() => setOpen(!open), [open, setOpen])

  const openWith = useCallback(
    (pid: string | null, initialInput?: string) => {
      setActiveProjectId(pid)
      if (initialInput !== undefined) setPendingInput(initialInput)
      setOpen(true)
    },
    [setActiveProjectId, setOpen],
  )

  // Refresh projects whenever drawer opens — keeps picker fresh after navigation
  // or external project creation.
  useEffect(() => {
    if (open) refreshProjects()
  }, [open, refreshProjects])

  // Keyboard shortcut: Cmd/Ctrl + Shift + L → toggle drawer; Esc closes when open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'L' || e.key === 'l')) {
        e.preventDefault()
        toggle()
      } else if (e.key === 'Escape' && open) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen, toggle])

  const value = useMemo<ChatDrawerContextValue>(
    () => ({
      open,
      setOpen,
      toggle,
      activeProjectId,
      setActiveProjectId,
      rebindActiveProjectId,
      panelResetKey,
      openWith,
      pendingInput,
      consumePendingInput,
      projects,
      refreshProjects,
      rebindNotice,
      notifyRebind,
      turnTick,
      notifyTurnComplete,
    }),
    [
      open,
      setOpen,
      toggle,
      activeProjectId,
      setActiveProjectId,
      rebindActiveProjectId,
      panelResetKey,
      openWith,
      pendingInput,
      consumePendingInput,
      projects,
      refreshProjects,
      rebindNotice,
      notifyRebind,
      turnTick,
      notifyTurnComplete,
    ],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useChatDrawer(): ChatDrawerContextValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useChatDrawer must be used inside ChatDrawerProvider')
  return v
}
