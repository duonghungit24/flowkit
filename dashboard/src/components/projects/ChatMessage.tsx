// Single chat message bubble + inline tool-call display.
import { useState, type ReactNode } from 'react'
import type { ToolCallDisplay } from '../../types'

interface Props {
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  toolCalls?: ToolCallDisplay[]
}

const METHOD_COLORS: Record<string, string> = {
  GET: 'var(--green)',
  POST: 'var(--accent)',
  PATCH: 'var(--yellow)',
  PUT: 'var(--yellow)',
  DELETE: 'var(--red)',
}

// Lightweight inline markdown — bold + inline code only.
function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let last = 0
  let m: RegExpExecArray | null
  let idx = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith('**')) {
      out.push(<strong key={`b${idx++}`}>{tok.slice(2, -2)}</strong>)
    } else {
      out.push(
        <code
          key={`c${idx++}`}
          className="px-1 rounded"
          style={{ background: 'var(--surface)', color: 'var(--accent)' }}
        >
          {tok.slice(1, -1)}
        </code>,
      )
    }
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function renderContent(content: string) {
  // Split on newlines, keep blank lines as spacing
  return content.split('\n').map((line, i) => (
    <div key={i} style={{ minHeight: '1em' }}>
      {renderInline(line)}
    </div>
  ))
}

function ToolCallCard({ tc }: { tc: ToolCallDisplay }) {
  const [open, setOpen] = useState(false)
  const color = METHOD_COLORS[tc.method] ?? 'var(--muted)'
  const bodyStr =
    tc.body !== undefined ? JSON.stringify(tc.body, null, 2) : ''
  return (
    <div
      className="rounded mt-2 text-xs"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-left"
        style={{ color: 'var(--muted)' }}
      >
        <span style={{ color }}>{open ? '▼' : '▶'}</span>
        <span className="font-bold" style={{ color }}>
          {tc.method}
        </span>
        <span className="font-mono truncate" style={{ color: 'var(--text)' }}>
          {tc.path}
        </span>
        {tc.error && (
          <span className="ml-auto" style={{ color: 'var(--red)' }}>
            error
          </span>
        )}
      </button>
      {open && (
        <div
          className="px-2 py-2 flex flex-col gap-2"
          style={{ borderTop: '1px solid var(--border)' }}
        >
          {bodyStr && (
            <div>
              <div
                className="text-xs font-bold mb-1"
                style={{ color: 'var(--muted)' }}
              >
                REQUEST
              </div>
              <pre
                className="text-xs p-2 rounded overflow-auto max-h-60"
                style={{ background: 'var(--bg)', color: 'var(--text)' }}
              >
                {bodyStr}
              </pre>
            </div>
          )}
          {tc.result && (
            <div>
              <div
                className="text-xs font-bold mb-1"
                style={{ color: 'var(--muted)' }}
              >
                RESULT
              </div>
              <pre
                className="text-xs p-2 rounded overflow-auto max-h-60"
                style={{ background: 'var(--bg)', color: 'var(--text)' }}
              >
                {tc.result}
              </pre>
            </div>
          )}
          {tc.error && (
            <div className="text-xs" style={{ color: 'var(--red)' }}>
              {tc.error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function ChatMessage({ role, content, toolCalls }: Props) {
  const isUser = role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className="rounded-lg px-3 py-2 max-w-[85%]"
        style={{
          background: isUser ? 'rgba(59,130,246,0.12)' : 'var(--card)',
          border: `1px solid ${isUser ? 'var(--accent)' : 'var(--border)'}`,
          color: 'var(--text)',
        }}
      >
        {content && (
          <div className="text-xs leading-relaxed">{renderContent(content)}</div>
        )}
        {toolCalls?.map(tc => <ToolCallCard key={tc.id} tc={tc} />)}
      </div>
    </div>
  )
}
