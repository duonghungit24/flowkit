import { Play, Copy } from 'lucide-react'
import type { LibrarySkill } from '../../types'

interface Props {
  skill: LibrarySkill
  onRunInChat: (name: string) => void
  onCopy: (cmd: string) => void
}

export default function SkillCard({ skill, onRunInChat, onCopy }: Props) {
  const cmd = `/${skill.name}`
  return (
    <div
      className="rounded-lg p-3 flex flex-col gap-2"
      style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="font-bold text-xs" style={{ color: 'var(--text)' }}>
          {skill.name}
        </div>
        <span
          className="text-xs px-2 py-0.5 rounded uppercase tracking-wide"
          style={{
            background: 'rgba(100,116,139,0.15)',
            color: 'var(--muted)',
            fontSize: 10,
          }}
        >
          {skill.stage}
        </span>
      </div>

      <div
        className="text-xs"
        style={{
          color: 'var(--muted)',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {skill.description}
      </div>

      <code
        className="text-xs px-2 py-1 rounded"
        style={{
          background: 'var(--surface)',
          color: 'var(--accent)',
          fontFamily: 'monospace',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={skill.usage}
      >
        {skill.usage}
      </code>

      {skill.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {skill.tags.map(t => (
            <span
              key={t}
              className="text-xs px-1.5 py-0.5 rounded"
              style={{
                background: 'rgba(59,130,246,0.15)',
                color: 'var(--accent)',
                fontSize: 10,
              }}
            >
              {t}
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-2 mt-1">
        <button
          onClick={() => onRunInChat(skill.name)}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold transition-opacity hover:opacity-80"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          <Play size={12} />
          Run in chat
        </button>
        <button
          onClick={() => onCopy(cmd)}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-opacity hover:opacity-80"
          style={{
            background: 'var(--surface)',
            color: 'var(--muted)',
            border: '1px solid var(--border)',
          }}
        >
          <Copy size={12} />
          Copy
        </button>
      </div>
    </div>
  )
}
