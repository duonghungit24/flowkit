// Native <select> picker for chat context: [Draft] + projects sorted by updated_at desc.
// Selecting Draft sets activeProjectId=null; selecting a project switches the chat scope.
import { useEffect, useState } from 'react'
import { useChatDrawer } from '../../lib/chat-drawer-context'

const REBIND_NOTICE_MS = 4000

export default function ChatProjectPicker() {
  const { activeProjectId, setActiveProjectId, projects, rebindNotice } = useChatDrawer()
  const [showRebind, setShowRebind] = useState(false)

  useEffect(() => {
    if (!rebindNotice) return
    setShowRebind(true)
    const t = setTimeout(() => setShowRebind(false), REBIND_NOTICE_MS)
    return () => clearTimeout(t)
  }, [rebindNotice])

  const reboundName = rebindNotice
    ? projects.find(p => p.id === rebindNotice.projectId)?.name ?? rebindNotice.projectId.slice(0, 8)
    : null

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-xs">
        <span style={{ color: 'var(--muted)' }}>Project:</span>
        <select
          value={activeProjectId ?? ''}
          onChange={e => setActiveProjectId(e.target.value || null)}
          className="text-xs px-2 py-1 rounded flex-1 min-w-0"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
          }}
        >
          <option value="">— Draft (no project) —</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      {showRebind && reboundName && (
        <div
          className="text-xs px-2 py-1 rounded"
          style={{ background: 'rgba(34,197,94,0.12)', color: 'var(--green)' }}
        >
          Switched to project: <strong>{reboundName}</strong>
        </div>
      )}
    </div>
  )
}
