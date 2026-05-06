import { useState } from 'react'
import SkillsTab from '../components/library/SkillsTab'
import MaterialsTab from '../components/library/MaterialsTab'

type Tab = 'Skills' | 'Materials'

const TABS: Tab[] = ['Skills', 'Materials']

export default function LibraryPage() {
  const [tab, setTab] = useState<Tab>('Skills')

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="font-bold text-sm" style={{ color: 'var(--text)' }}>
          Library
        </h1>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          Browse FlowKit skills and visual style materials.
        </p>
      </div>

      <div
        className="flex gap-1"
        style={{ borderBottom: '1px solid var(--border)', paddingBottom: 4 }}
      >
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-3 py-1.5 rounded-t text-xs font-semibold transition-colors"
            style={{
              background: tab === t ? 'var(--card)' : 'transparent',
              color: tab === t ? 'var(--accent)' : 'var(--muted)',
              borderBottom:
                tab === t ? '2px solid var(--accent)' : '2px solid transparent',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      <div>
        {tab === 'Skills' && <SkillsTab />}
        {tab === 'Materials' && <MaterialsTab />}
      </div>
    </div>
  )
}
