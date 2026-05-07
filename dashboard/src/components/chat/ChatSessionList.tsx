// Sidebar listing chat sessions for the active project.
import type { ChatSession } from '../../types'

interface Props {
  sessions: ChatSession[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
}

function shortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function ChatSessionList({
  sessions,
  activeId,
  onSelect,
  onNew,
  onDelete,
}: Props) {
  return (
    <div
      className="flex flex-col gap-2 rounded-lg p-2"
      style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
    >
      <button
        onClick={onNew}
        className="text-xs px-3 py-2 rounded font-semibold"
        style={{ background: 'var(--accent)', color: 'white' }}
      >
        + New Chat
      </button>
      <div
        className="flex flex-col gap-1 overflow-auto"
        style={{ maxHeight: '60vh' }}
      >
        {sessions.length === 0 && (
          <div className="text-xs px-2 py-1" style={{ color: 'var(--muted)' }}>
            No sessions yet.
          </div>
        )}
        {sessions.map(s => {
          const active = s.id === activeId
          return (
            <div
              key={s.id}
              className="group flex items-center gap-1 rounded px-2 py-1.5"
              style={{
                background: active ? 'var(--surface)' : 'transparent',
                border: active
                  ? '1px solid var(--accent)'
                  : '1px solid transparent',
              }}
            >
              <button
                onClick={() => onSelect(s.id)}
                className="flex-1 text-left flex flex-col gap-0.5 min-w-0"
              >
                <div
                  className="text-xs font-semibold truncate"
                  style={{ color: active ? 'var(--accent)' : 'var(--text)' }}
                >
                  {s.title || 'Untitled'}
                </div>
                <div className="text-xs" style={{ color: 'var(--muted)' }}>
                  {shortDate(s.updated_at)}
                </div>
              </button>
              <button
                onClick={e => {
                  e.stopPropagation()
                  onDelete(s.id)
                }}
                className="text-xs px-1 opacity-0 group-hover:opacity-100"
                style={{ color: 'var(--muted)' }}
                title="Delete session"
              >
                ×
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
