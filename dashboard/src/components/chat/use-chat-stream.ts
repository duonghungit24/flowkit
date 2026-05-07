// NDJSON stream consumer — owns transcript + tool-call display state during a turn.
// Handles native Claude Code events: text deltas, tool_use, tool_result, session,
// session_rebind (auto project rebind from chat backend), error, done.
import { useCallback, useState } from 'react'
import { streamChat } from '../../api/chat-api'
import type {
  ChatMessageRecord,
  NdjsonEvent,
  ToolCallDisplay,
} from '../../types'

export interface DisplayMessage {
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  toolCalls: ToolCallDisplay[]
}

export interface UseChatStream {
  messages: DisplayMessage[]
  setMessages: React.Dispatch<React.SetStateAction<DisplayMessage[]>>
  streaming: boolean
  error: string | null
  send: (text: string) => Promise<void>
  hydrate: (records: ChatMessageRecord[]) => void
  reset: () => void
}

interface Args {
  projectId: string | null
  activeSessionId: string | null
  onSessionStarted: (sid: string) => void
  onRebind?: (projectId: string) => void
  onTurnComplete?: () => void
}

function hydrateRecords(records: ChatMessageRecord[]): DisplayMessage[] {
  return records
    .filter(r => r.role === 'user' || r.role === 'assistant')
    .map(r => ({ role: r.role, content: r.content, toolCalls: [] }))
}

export function useChatStream({
  projectId,
  activeSessionId,
  onSessionStarted,
  onRebind,
  onTurnComplete,
}: Args): UseChatStream {
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hydrate = useCallback((records: ChatMessageRecord[]) => {
    setMessages(hydrateRecords(records))
  }, [])

  const reset = useCallback(() => {
    setMessages([])
    setError(null)
  }, [])

  const send = useCallback(
    async (text: string) => {
      if (streaming) return
      setError(null)

      const history: DisplayMessage[] = [
        ...messages,
        { role: 'user', content: text, toolCalls: [] },
      ]
      setMessages(history)
      setStreaming(true)

      const apiMessages = history.map(m => ({ role: m.role, content: m.content }))
      let assistantIdx = -1

      function ensureAssistantBubble(prev: DisplayMessage[]): DisplayMessage[] {
        if (assistantIdx !== -1 && prev[assistantIdx]?.role === 'assistant') return prev
        const out = [...prev, { role: 'assistant' as const, content: '', toolCalls: [] }]
        assistantIdx = out.length - 1
        return out
      }

      function applyEvent(ev: NdjsonEvent) {
        switch (ev.type) {
          case 'session': {
            onSessionStarted(ev.session_id)
            break
          }
          case 'text': {
            setMessages(prev => {
              const out = ensureAssistantBubble(prev)
              const cur = out[assistantIdx]
              out[assistantIdx] = { ...cur, content: cur.content + ev.delta }
              return out
            })
            break
          }
          case 'tool_use': {
            const tc: ToolCallDisplay = { id: ev.id, name: ev.name, input: ev.input }
            setMessages(prev => {
              const out = ensureAssistantBubble(prev)
              const cur = out[assistantIdx]
              out[assistantIdx] = { ...cur, toolCalls: [...cur.toolCalls, tc] }
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
                  next[idx] = { ...next[idx], result: ev.content, isError: ev.is_error }
                  out[i] = { ...out[i], toolCalls: next }
                  break
                }
              }
              return out
            })
            // Reset bubble pointer so following text deltas open a fresh bubble.
            assistantIdx = -1
            break
          }
          case 'session_rebind': {
            // Backend bound this session to a real project (e.g. /fk-create-project).
            onRebind?.(ev.project_id)
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
            if (ev.session_id) onSessionStarted(ev.session_id)
            break
          }
        }
      }

      try {
        const stream = streamChat({
          messages: apiMessages,
          projectId,
          sessionId: activeSessionId,
        })
        for await (const ev of stream) applyEvent(ev)
      } catch (e) {
        setError(String(e))
        setMessages(prev => [
          ...prev,
          { role: 'assistant', content: `Error: ${String(e)}`, toolCalls: [] },
        ])
      } finally {
        setStreaming(false)
        onTurnComplete?.()
      }
    },
    [activeSessionId, messages, onRebind, onSessionStarted, onTurnComplete, projectId, streaming],
  )

  return { messages, setMessages, streaming, error, send, hydrate, reset }
}
