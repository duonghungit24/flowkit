import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { fetchAPI } from '../../api/client'
import { useDebounce } from '../../lib/use-debounce'
import type { Material } from '../../types'
import MaterialPreviewModal from './MaterialPreviewModal'

type Filter = 'all' | 'builtin' | 'custom'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'builtin', label: 'Built-in' },
  { key: 'custom', label: 'Custom' },
]

function MaterialCard({
  material,
  onClick,
}: {
  material: Material
  onClick: () => void
}) {
  return (
    <div
      onClick={onClick}
      className="rounded-lg p-3 flex flex-col gap-2 cursor-pointer transition-opacity hover:opacity-80"
      style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="font-bold text-xs flex-1" style={{ color: 'var(--text)' }}>
          {material.name}
        </div>
        <span
          className="text-xs px-1.5 py-0.5 rounded"
          style={{
            background: material.is_builtin ? 'rgba(59,130,246,0.2)' : 'rgba(34,197,94,0.2)',
            color: material.is_builtin ? 'var(--accent)' : 'var(--green)',
            fontSize: 10,
          }}
        >
          {material.is_builtin ? 'BUILT-IN' : 'CUSTOM'}
        </span>
      </div>
      <code
        className="text-xs px-2 py-0.5 rounded w-fit"
        style={{
          background: 'var(--surface)',
          color: 'var(--accent)',
          fontFamily: 'monospace',
        }}
      >
        {material.id}
      </code>
      <div
        className="text-xs"
        style={{
          color: 'var(--muted)',
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {material.style_instruction}
      </div>
    </div>
  )
}

export default function MaterialsTab() {
  const [materials, setMaterials] = useState<Material[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Material | null>(null)
  const debounced = useDebounce(search, 200)

  useEffect(() => {
    fetchAPI<Material[]>('/api/materials')
      .then(setMaterials)
      .catch(e => setError(String(e)))
  }, [])

  const filtered = useMemo(() => {
    if (!materials) return []
    const q = debounced.toLowerCase()
    return materials.filter(m => {
      if (filter === 'builtin' && !m.is_builtin) return false
      if (filter === 'custom' && m.is_builtin) return false
      if (q) {
        const hay = `${m.name} ${m.id} ${m.style_instruction}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [materials, filter, debounced])

  if (error) {
    return (
      <div className="text-xs" style={{ color: 'var(--red)' }}>
        Error loading materials: {error}
      </div>
    )
  }
  if (!materials) {
    return <div className="text-xs" style={{ color: 'var(--muted)' }}>Loading materials…</div>
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Filter chips + search */}
      <div className="flex items-center gap-2 flex-wrap">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className="px-3 py-1.5 rounded text-xs font-semibold transition-colors"
            style={{
              background: filter === f.key ? 'var(--accent)' : 'var(--card)',
              color: filter === f.key ? '#fff' : 'var(--muted)',
              border: '1px solid var(--border)',
            }}
          >
            {f.label}
          </button>
        ))}
        <div
          className="flex items-center gap-2 px-2 py-1.5 rounded flex-1 max-w-md"
          style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
        >
          <Search size={14} style={{ color: 'var(--muted)' }} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search materials by name, id, or instruction"
            className="flex-1 bg-transparent outline-none text-xs"
            style={{ color: 'var(--text)' }}
          />
        </div>
        <span className="text-xs" style={{ color: 'var(--muted)' }}>
          {filtered.length} / {materials.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="text-xs" style={{ color: 'var(--muted)' }}>
          No materials match.
        </div>
      ) : (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}
        >
          {filtered.map(m => (
            <MaterialCard key={m.id} material={m} onClick={() => setSelected(m)} />
          ))}
        </div>
      )}

      <MaterialPreviewModal material={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
