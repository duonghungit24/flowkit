// Single chat message bubble + inline tool-use display.
import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ToolCallDisplay } from '../../types'

interface Props {
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  toolCalls?: ToolCallDisplay[]
}

// Markdown rendering — GFM (tables, task-lists, strikethrough) + theme-aware
// styling via component overrides. Keep links safe (target=_blank, noopener).
function MarkdownContent({ text }: { text: string }) {
  return (
    <div className="md-body text-xs leading-relaxed break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _n, ...p }) => (
            <a
              {...p}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--accent)', textDecoration: 'underline' }}
            />
          ),
          code: ({ node: _n, className, children, ...p }) => {
            const isBlock = /\n/.test(String(children))
            if (isBlock) {
              return (
                <code className={className} {...p}>
                  {children}
                </code>
              )
            }
            return (
              <code
                className="px-1 rounded"
                style={{ background: 'var(--surface)', color: 'var(--accent)' }}
                {...p}
              >
                {children}
              </code>
            )
          },
          pre: ({ node: _n, children, ...p }) => (
            <pre
              className="text-xs p-2 rounded overflow-auto whitespace-pre-wrap break-words my-2"
              style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}
              {...p}
            >
              {children}
            </pre>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

// One-line summary of a tool_use input — Bash gets command, Read/Edit get file_path,
// everything else falls back to compact JSON.
function summariseInput(name: string, input: Record<string, unknown>): string {
  if (!input || typeof input !== 'object') return ''
  if (name === 'Bash') return String(input.command ?? '')
  if (name === 'Read' || name === 'Write' || name === 'Edit' || name === 'NotebookEdit') {
    return String(input.file_path ?? input.path ?? '')
  }
  if (name === 'Glob') return String(input.pattern ?? '')
  if (name === 'Grep') return String(input.pattern ?? '')
  return JSON.stringify(input)
}

function ToolCallCard({ tc }: { tc: ToolCallDisplay }) {
  const [open, setOpen] = useState(false)
  const summary = summariseInput(tc.name, tc.input)
  const accent = tc.isError ? 'var(--red)' : 'var(--accent)'
  const inputStr = JSON.stringify(tc.input ?? {}, null, 2)
  return (
    <div
      className="rounded mt-2 text-xs"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-left min-w-0"
        style={{ color: 'var(--muted)' }}
      >
        <span style={{ color: accent }}>{open ? '▼' : '▶'}</span>
        <span className="font-bold flex-shrink-0" style={{ color: accent }}>
          {tc.name}
        </span>
        <span
          className="font-mono truncate flex-1 min-w-0"
          style={{ color: 'var(--text)' }}
          title={summary}
        >
          {summary}
        </span>
        {tc.isError && (
          <span style={{ color: 'var(--red)' }}>error</span>
        )}
      </button>
      {open && (
        <div
          className="px-2 py-2 flex flex-col gap-2"
          style={{ borderTop: '1px solid var(--border)' }}
        >
          <div>
            <div className="text-xs font-bold mb-1" style={{ color: 'var(--muted)' }}>
              INPUT
            </div>
            <pre
              className="text-xs p-2 rounded overflow-auto max-h-60 whitespace-pre-wrap break-all"
              style={{ background: 'var(--bg)', color: 'var(--text)' }}
            >
              {inputStr}
            </pre>
          </div>
          {tc.result && (
            <div>
              <div className="text-xs font-bold mb-1" style={{ color: 'var(--muted)' }}>
                {tc.isError ? 'ERROR' : 'RESULT'}
              </div>
              <pre
                className="text-xs p-2 rounded overflow-auto max-h-60 whitespace-pre-wrap break-all"
                style={{ background: 'var(--bg)', color: tc.isError ? 'var(--red)' : 'var(--text)' }}
              >
                {tc.result}
              </pre>
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
    <div className={`flex min-w-0 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className="rounded-lg px-3 py-2 max-w-[85%] min-w-0 overflow-hidden"
        style={{
          background: isUser ? 'rgba(59,130,246,0.12)' : 'var(--card)',
          border: `1px solid ${isUser ? 'var(--accent)' : 'var(--border)'}`,
          color: 'var(--text)',
        }}
      >
        {content && <MarkdownContent text={content} />}
        {toolCalls?.map(tc => <ToolCallCard key={tc.id} tc={tc} />)}
      </div>
    </div>
  )
}
