// Project-agnostic chat panel. Pass projectId=null for draft (no project context).
// Composes useChatSessions + useChatStream hooks; layout = session list + transcript + input.
import { useCallback, useEffect, useRef } from 'react'
import ChatInput from './ChatInput'
import ChatMessage from './ChatMessage'
import ChatSessionList from './ChatSessionList'
import { useChatSessions } from './use-chat-sessions'
import { useChatStream } from './use-chat-stream'

interface Props {
  projectId: string | null
  initialInput?: string | null
  onInitialInputConsumed?: () => void
  onTurnComplete?: () => void
  onRebind?: (newProjectId: string) => void
  // Optional layout overrides for the parent shell (drawer wants different sizing).
  height?: string | number
  showSessionList?: boolean
}

export default function ChatPanel({
  projectId,
  initialInput,
  onInitialInputConsumed,
  onTurnComplete,
  onRebind,
  height = 'calc(100vh - 220px)',
  showSessionList = true,
}: Props) {
  const sessionsHook = useChatSessions(projectId)
  const scrollRef = useRef<HTMLDivElement>(null)

  const handleSessionStarted = useCallback(
    (sid: string) => {
      if (!sessionsHook.activeId) sessionsHook.setActiveId(sid)
    },
    [sessionsHook],
  )

  const stream = useChatStream({
    projectId,
    activeSessionId: sessionsHook.activeId,
    onSessionStarted: handleSessionStarted,
    onRebind,
    onTurnComplete: () => {
      sessionsHook.refresh().catch(() => {})
      onTurnComplete?.()
    },
  })

  // Hydrate transcript when activeId changes (selecting a session from the list).
  useEffect(() => {
    let cancelled = false
    const sid = sessionsHook.activeId
    if (!sid) {
      stream.reset()
      return
    }
    ;(async () => {
      const records = await sessionsHook.load(sid)
      if (!cancelled) stream.hydrate(records)
    })()
    return () => {
      cancelled = true
    }
    // load + hydrate are stable enough; rely on activeId change as the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionsHook.activeId])

  // Auto-scroll on new content.
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [stream.messages])

  const newChat = () => {
    sessionsHook.reset()
    stream.reset()
  }

  const error = stream.error || sessionsHook.error
  const messages = stream.messages

  return (
    <div
      className="grid gap-4 h-full min-h-0"
      style={{
        gridTemplateColumns: showSessionList ? '220px minmax(0, 1fr)' : 'minmax(0, 1fr)',
      }}
    >
      {showSessionList && (
        <ChatSessionList
          sessions={sessionsHook.sessions}
          activeId={sessionsHook.activeId}
          onSelect={sid => sessionsHook.setActiveId(sid)}
          onNew={newChat}
          onDelete={sessionsHook.remove}
        />
      )}
      <div
        className="flex flex-col rounded-lg"
        style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          height,
          minHeight: 400,
        }}
      >
        <div ref={scrollRef} className="flex-1 overflow-auto p-4 flex flex-col gap-3">
          {messages.length === 0 && !stream.streaming && (
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
          {stream.streaming && (
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
            onSend={stream.send}
            disabled={stream.streaming}
            initialValue={initialInput}
            onInitialValueConsumed={onInitialInputConsumed}
          />
        </div>
      </div>
    </div>
  )
}
