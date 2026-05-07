// Chat textarea with Enter-to-send + /fk- skill autocomplete.
import { useEffect, useRef, useState } from 'react'
import { listSkills } from '../../api/chat-api'
import type { LibrarySkill } from '../../types'

interface Props {
  onSend: (text: string) => void
  disabled?: boolean
  placeholder?: string
  initialValue?: string | null
  onInitialValueConsumed?: () => void
}

const SKILL_TRIGGER = /(^|\s)\/(fk[-\w]*)$/

export default function ChatInput({
  onSend,
  disabled,
  placeholder,
  initialValue,
  onInitialValueConsumed,
}: Props) {
  const [value, setValue] = useState('')
  const [skills, setSkills] = useState<LibrarySkill[]>([])
  const [matches, setMatches] = useState<LibrarySkill[]>([])
  const [highlight, setHighlight] = useState(0)
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (initialValue) {
      setValue(initialValue)
      onInitialValueConsumed?.()
      requestAnimationFrame(() => {
        const ta = taRef.current
        if (!ta) return
        ta.focus()
        ta.setSelectionRange(initialValue.length, initialValue.length)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialValue])

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const v = e.target.value
    setValue(v)
    const m = v.match(SKILL_TRIGGER)
    if (!m) {
      setMatches([])
      return
    }
    const prefix = m[2].toLowerCase()
    if (!skills.length) {
      listSkills().then(s => {
        setSkills(s)
        setMatches(filterSkills(s, prefix))
      }).catch(() => setMatches([]))
    } else {
      setMatches(filterSkills(skills, prefix))
    }
    setHighlight(0)
  }

  function filterSkills(all: LibrarySkill[], prefix: string): LibrarySkill[] {
    return all
      .filter(s => s.name.toLowerCase().startsWith(prefix))
      .slice(0, 8)
  }

  function applySkill(skill: LibrarySkill) {
    const m = value.match(SKILL_TRIGGER)
    if (!m) return
    const start = value.length - m[0].length + (m[1] ? 1 : 0)
    const next = value.slice(0, start) + `/${skill.name} `
    setValue(next)
    setMatches([])
    requestAnimationFrame(() => taRef.current?.focus())
  }

  function send() {
    const text = value.trim()
    if (!text || disabled) return
    onSend(text)
    setValue('')
    setMatches([])
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (matches.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlight(h => (h + 1) % matches.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlight(h => (h - 1 + matches.length) % matches.length)
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault()
        applySkill(matches[highlight])
        return
      }
      if (e.key === 'Escape') {
        setMatches([])
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'
  }, [value])

  return (
    <div className="relative">
      {matches.length > 0 && (
        <div
          className="absolute bottom-full left-0 right-0 mb-1 rounded-lg overflow-hidden z-10"
          style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
        >
          {matches.map((s, i) => (
            <button
              key={s.name}
              onMouseDown={e => {
                e.preventDefault()
                applySkill(s)
              }}
              onMouseEnter={() => setHighlight(i)}
              className="w-full text-left px-3 py-2 flex flex-col gap-0.5"
              style={{
                background: i === highlight ? 'var(--surface)' : 'transparent',
                color: 'var(--text)',
              }}
            >
              <span className="text-xs font-bold" style={{ color: 'var(--accent)' }}>
                /{s.name}
              </span>
              <span className="text-xs" style={{ color: 'var(--muted)' }}>
                {s.description}
              </span>
            </button>
          ))}
        </div>
      )}
      <div
        className="flex items-end gap-2 rounded-lg p-2"
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
      >
        <textarea
          ref={taRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={placeholder ?? 'Ask FlowKit… (try /fk-status, Shift+Enter for newline)'}
          rows={1}
          className="flex-1 resize-none outline-none text-xs bg-transparent"
          style={{ color: 'var(--text)', minHeight: 24 }}
        />
        <button
          onClick={send}
          disabled={disabled || !value.trim()}
          className="text-xs px-3 py-1.5 rounded font-semibold"
          style={{
            background: disabled || !value.trim() ? 'var(--surface)' : 'var(--accent)',
            color: disabled || !value.trim() ? 'var(--muted)' : 'white',
            cursor: disabled || !value.trim() ? 'not-allowed' : 'pointer',
          }}
        >
          Send
        </button>
      </div>
    </div>
  )
}
