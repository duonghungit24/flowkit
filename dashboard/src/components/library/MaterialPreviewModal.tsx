import { useEffect, useState } from 'react'
import { Copy, X } from 'lucide-react'
import type { Material } from '../../types'

interface Props {
  material: Material | null
  onClose: () => void
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-bold mb-1" style={{ color: 'var(--muted)' }}>
        {label}
      </div>
      <div
        className="text-xs whitespace-pre-wrap rounded p-2"
        style={{
          background: 'var(--surface)',
          color: 'var(--text)',
          border: '1px solid var(--border)',
        }}
      >
        {value}
      </div>
    </div>
  )
}

export default function MaterialPreviewModal({ material, onClose }: Props) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!material) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [material, onClose])

  if (!material) return null

  async function handleCopyId() {
    if (!material) return
    try {
      await navigator.clipboard.writeText(material.id)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* noop */
    }
  }

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Material details: ${material.name}`}
    >
      <div
        className="rounded-lg p-5 flex flex-col gap-3 max-w-2xl w-full max-h-[80vh] overflow-auto"
        style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          margin: 16,
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <div className="font-bold text-sm" style={{ color: 'var(--text)' }}>
              {material.name}
            </div>
            <div className="flex items-center gap-2">
              <code
                className="text-xs px-2 py-0.5 rounded"
                style={{
                  background: 'var(--surface)',
                  color: 'var(--accent)',
                  fontFamily: 'monospace',
                }}
              >
                {material.id}
              </code>
              <span
                className="text-xs px-2 py-0.5 rounded"
                style={{
                  background: material.is_builtin ? 'rgba(59,130,246,0.2)' : 'rgba(34,197,94,0.2)',
                  color: material.is_builtin ? 'var(--accent)' : 'var(--green)',
                  fontSize: 10,
                }}
              >
                {material.is_builtin ? 'BUILT-IN' : 'CUSTOM'}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded transition-opacity hover:opacity-80"
            style={{ color: 'var(--muted)' }}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <Field label="STYLE INSTRUCTION" value={material.style_instruction} />
        {material.lighting && <Field label="LIGHTING" value={material.lighting} />}
        {material.scene_prefix && (
          <Field label="SCENE PREFIX" value={material.scene_prefix} />
        )}
        {material.negative_prompt && (
          <Field label="NEGATIVE PROMPT" value={material.negative_prompt} />
        )}

        <button
          onClick={handleCopyId}
          className="flex items-center gap-1 px-3 py-1.5 rounded text-xs font-semibold w-fit transition-opacity hover:opacity-80"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          <Copy size={12} />
          {copied ? 'Copied!' : 'Copy ID'}
        </button>
      </div>
    </div>
  )
}
