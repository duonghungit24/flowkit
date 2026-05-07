import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import { listSkills } from '../../api/chat-api'
import { useChatDrawer } from '../../lib/chat-drawer-context'
import { getLastProjectId } from '../../lib/last-project'
import { useDebounce } from '../../lib/use-debounce'
import type { LibrarySkill } from '../../types'
import SkillCard from './SkillCard'

const STAGE_ORDER = ['setup', 'generation', 'audio', 'post-process', 'qa-review', 'utility']

const STAGE_LABEL: Record<string, string> = {
  setup: 'Setup',
  generation: 'Generation',
  audio: 'Audio',
  'post-process': 'Post-process',
  'qa-review': 'QA / Review',
  utility: 'Utility',
}

function matches(skill: LibrarySkill, q: string): boolean {
  if (!q) return true
  const hay = `${skill.name} ${skill.description} ${skill.tags.join(' ')}`.toLowerCase()
  return hay.includes(q.toLowerCase())
}

export default function SkillsTab() {
  const { openWith } = useChatDrawer()
  const [skills, setSkills] = useState<LibrarySkill[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<number | null>(null)
  const debounced = useDebounce(search, 200)

  useEffect(() => {
    return () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
    }
  }, [])

  useEffect(() => {
    listSkills()
      .then(setSkills)
      .catch(e => setError(String(e)))
  }, [])

  const grouped = useMemo(() => {
    if (!skills) return null
    const filtered = skills.filter(s => matches(s, debounced))
    const out: Record<string, LibrarySkill[]> = {}
    for (const s of filtered) {
      const key = s.stage || 'utility'
      ;(out[key] ??= []).push(s)
    }
    return out
  }, [skills, debounced])

  function showToast(msg: string) {
    setToast(msg)
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => {
      setToast(null)
      toastTimer.current = null
    }, 2000)
  }

  function handleRunInChat(name: string) {
    // Open the global drawer pre-bound to the user's last project (or Draft if
    // none) and pre-fill the input with /<skill-name>.
    const pid = getLastProjectId()
    openWith(pid, `/${name} `)
  }

  async function handleCopy(cmd: string) {
    try {
      await navigator.clipboard.writeText(cmd)
      showToast(`Copied ${cmd}`)
    } catch {
      showToast('Copy failed')
    }
  }

  function toggleStage(key: string) {
    setCollapsed(c => ({ ...c, [key]: !c[key] }))
  }

  if (error) {
    return (
      <div className="text-xs" style={{ color: 'var(--red)' }}>
        Error loading skills: {error}
      </div>
    )
  }
  if (!skills) {
    return <div className="text-xs" style={{ color: 'var(--muted)' }}>Loading skills…</div>
  }

  const totalMatching = grouped ? Object.values(grouped).reduce((n, a) => n + a.length, 0) : 0

  return (
    <div className="flex flex-col gap-4">
      {/* Search */}
      <div className="flex items-center gap-2">
        <div
          className="flex items-center gap-2 px-2 py-1.5 rounded flex-1 max-w-md"
          style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
        >
          <Search size={14} style={{ color: 'var(--muted)' }} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search skills by name, description, or tag"
            className="flex-1 bg-transparent outline-none text-xs"
            style={{ color: 'var(--text)' }}
          />
        </div>
        <span className="text-xs" style={{ color: 'var(--muted)' }}>
          {totalMatching} / {skills.length}
        </span>
      </div>

      {totalMatching === 0 && (
        <div className="text-xs" style={{ color: 'var(--muted)' }}>
          No skills match your search.
        </div>
      )}

      {/* Stage groups */}
      {STAGE_ORDER.map(stage => {
        const items = grouped?.[stage] ?? []
        if (items.length === 0) return null
        const isCollapsed = !!collapsed[stage]
        return (
          <div key={stage} className="flex flex-col gap-2">
            <button
              onClick={() => toggleStage(stage)}
              className="flex items-center gap-1 text-xs font-bold uppercase tracking-wide w-fit"
              style={{ color: 'var(--muted)' }}
            >
              {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              {STAGE_LABEL[stage] ?? stage} ({items.length})
            </button>
            {!isCollapsed && (
              <div
                className="grid gap-3"
                style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}
              >
                {items.map(s => (
                  <SkillCard
                    key={s.name}
                    skill={s}
                    onRunInChat={handleRunInChat}
                    onCopy={handleCopy}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-4 right-4 px-3 py-2 rounded text-xs"
          style={{
            background: 'var(--card)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          }}
        >
          {toast}
        </div>
      )}
    </div>
  )
}
