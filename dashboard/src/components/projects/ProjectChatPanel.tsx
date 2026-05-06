// Top-level chat panel: session list + transcript + input.
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  confirmToolCall,
  deleteSession,
  getSession,
  listSessions,
  streamChat,
} from '../../api/chat-api'
import type {
  ChatMessageRecord,
  ChatSession,
  NdjsonEvent,
  ToolCallDisplay,
} from '../../types'
import ChatInput from './ChatInput'
import ChatMessage from './ChatMessage'
import ChatSessionList from './ChatSessionList'
import ConfirmModal from '../shared/ConfirmModal'

interface Props {
  projectId: string
  initialInput?: string | null
  onInitialInputConsumed?: () => void
}

interface DisplayMessage {
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  toolCalls: ToolCallDisplay[]
}

interface ConfirmEvent {
  id: string
  method: string
  path: string
  body?: unknown
}

const LS_KEY = (projectId: string) => `fk-chat-session:${projectId}`

function hydrateMessages(records: ChatMessageRecord[]): DisplayMessage[] {
  return records
    .filter(r => r.role === 'user' || r.role === 'assistant')
    .map(r => ({
      role: r.role,
      content: r.content,
      toolCalls: [],
    }))
}

export default function ProjectChatPanel({
  projectId,
  initialInput,
  onInitialInputConsumed,
}: Props) {
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [confirmEvent, setConfirmEvent] = useState<ConfirmEvent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const refreshSessions = useCallback(async () => {
    const list = await listSessions(projectId)
    setSessions(list)
    return list
  }, [projectId])

  // Initial load + restore last session from localStorage
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const list = await refreshSessions()
        if (cancelled) return
        const remembered = localStorage.getItem(LS_KEY(projectId))
        const exists = list.find(s => s.id === remembered)
        if (exists) {
          await loadSession(exists.id)
        } else {
          setActiveId(null)
          setMessages([])
        }
      } catch (e) {
        setError(String(e))
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  // Auto-scroll on new messages
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [messages])

  async function loadSession(sid: string) {
    setActiveId(sid)
    localStorage.setItem(LS_KEY(projectId), sid)
    try {
      const { messages: records } = await getSession(sid)
      setMessages(hydrateMessages(records))
    } catch (e) {
      setError(String(e))
    }
  }

  function newChat() {
    setActiveId(null)
    setMessages([])
    localStorage.removeItem(LS_KEY(projectId))
  }

  async function handleDelete(sid: string) {
    try {
      await deleteSession(sid)
      if (activeId === sid) newChat()
      await refreshSessions()
    } catch (e) {
      setError(String(e))
    }
  }

  async function decideConfirm(approved: boolean) {
    if (!confirmEvent) return
    const pending = confirmEvent
    setConfirmEvent(null)
    try {
      await confirmToolCall({
        toolCallId: pending.id,
        approved,
        sessionId: activeId,
      })
    } catch (e) {
      // Most likely the Future already timed out (120s). Surface to user;
      // the open stream will yield the rejection result on its own.
      setError(`Confirmation failed: ${String(e)}`)
    }
  }

  async function handleSend(text: string) {
    if (streaming) return
    setError(null)

    const history = [...messages, { role: 'user' as const, content: text, toolCalls: [] }]
    setMessages(history)
    setStreaming(true)

    const apiMessages = history.map(m => ({ role: m.role, content: m.content }))
    let assistantIdx = -1

    try {
      const stream = streamChat({
        messages: apiMessages,
        projectId,
        sessionId: activeId,
      })
      for await (const ev of stream) {
        applyEvent(ev)
      }
    } catch (e) {
      setError(String(e))
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: `Error: ${String(e)}`, toolCalls: [] },
      ])
    } finally {
      setStreaming(false)
      refreshSessions().catch(() => {})
    }

    function applyEvent(ev: NdjsonEvent) {
      switch (ev.type) {
        case 'session': {
          if (!activeId) {
            setActiveId(ev.session_id)
            localStorage.setItem(LS_KEY(projectId), ev.session_id)
          }
          break
        }
        case 'text': {
          setMessages(prev => {
            const out = [...prev]
            if (assistantIdx === -1 || out[assistantIdx]?.role !== 'assistant') {
              out.push({ role: 'assistant', content: ev.delta, toolCalls: [] })
              assistantIdx = out.length - 1
            } else {
              out[assistantIdx] = {
                ...out[assistantIdx],
                content: out[assistantIdx].content + ev.delta,
              }
            }
            return out
          })
          break
        }
        case 'tool_call': {
          const tc: ToolCallDisplay = {
            id: ev.id,
            name: ev.name,
            method: ev.args?.method ?? 'GET',
            path: ev.args?.path ?? '/',
            body: ev.args?.body,
          }
          setMessages(prev => {
            const out = [...prev]
            if (assistantIdx === -1 || out[assistantIdx]?.role !== 'assistant') {
              out.push({ role: 'assistant', content: '', toolCalls: [tc] })
              assistantIdx = out.length - 1
            } else {
              out[assistantIdx] = {
                ...out[assistantIdx],
                toolCalls: [...out[assistantIdx].toolCalls, tc],
              }
            }
            return out
          })
          break
        }
        case 'tool_result': {
          setMessages(prev => {
            const out = [...prev]
            for (let i = out.length - 1; i >= 0; i--) {
              const tcs = out[i].toolCalls
              const idx = tcs.findIndex(t => t.id === ev.id)
              if (idx !== -1) {
                const next = [...tcs]
                next[idx] = { ...next[idx], result: ev.content }
                out[i] = { ...out[i], toolCalls: next }
                break
              }
            }
            return out
          })
          // Reset assistantIdx so next text delta starts a fresh bubble
          assistantIdx = -1
          break
        }
        case 'confirm_required': {
          setConfirmEvent({
            id: ev.id,
            method: ev.method,
            path: ev.path,
            body: ev.body,
          })
          break
        }
        case 'error': {
          setError(ev.content)
          setMessages(prev => [
            ...prev,
            { role: 'assistant', content: `Error: ${ev.content}`, toolCalls: [] },
          ])
          break
        }
        case 'done': {
          if (ev.session_id && !activeId) {
            setActiveId(ev.session_id)
            localStorage.setItem(LS_KEY(projectId), ev.session_id)
          }
          break
        }
      }
    }
  }

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: '220px 1fr' }}>
      <ChatSessionList
        sessions={sessions}
        activeId={activeId}
        onSelect={loadSession}
        onNew={newChat}
        onDelete={handleDelete}
      />
      <div
        className="flex flex-col rounded-lg"
        style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          height: 'calc(100vh - 220px)',
          minHeight: 400,
        }}
      >
        <div ref={scrollRef} className="flex-1 overflow-auto p-4 flex flex-col gap-3">
          {messages.length === 0 && !streaming && (
            <div className="text-xs text-center mt-8" style={{ color: 'var(--muted)' }}>
              Start a new chat. Try <code>/fk-status</code> or "list my videos".
            </div>
          )}
          {messages.map((m, i) => (
            <ChatMessage
              key={i}
              role={m.role}
              content={m.content}
              toolCalls={m.toolCalls}
            />
          ))}
          {streaming && (
            <div className="text-xs flex items-center gap-2" style={{ color: 'var(--muted)' }}>
              <span
                className="inline-block w-2 h-2 rounded-full animate-pulse"
                style={{ background: 'var(--accent)' }}
              />
              thinking…
            </div>
          )}
        </div>
        {error && (
          <div
            className="px-4 py-2 text-xs"
            style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--red)' }}
          >
            {error}
          </div>
        )}
        <div className="p-3" style={{ borderTop: '1px solid var(--border)' }}>
          <ChatInput
            onSend={handleSend}
            disabled={streaming || !!confirmEvent}
            initialValue={initialInput}
            onInitialValueConsumed={onInitialInputConsumed}
          />
        </div>
      </div>
      <ConfirmModal
        open={!!confirmEvent}
        method={confirmEvent?.method ?? ''}
        path={confirmEvent?.path ?? ''}
        bodySummary={
          confirmEvent?.body !== undefined
            ? JSON.stringify(confirmEvent.body, null, 2)
            : undefined
        }
        onApprove={() => decideConfirm(true)}
        onReject={() => decideConfirm(false)}
      />
    </div>
  )
}
