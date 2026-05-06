// Confirmation modal for mutating tool calls. P2 stub — P4 wires real approve/reject.
interface Props {
  open: boolean
  method: string
  path: string
  bodySummary?: string
  onApprove: () => void
  onReject: () => void
}

export default function ConfirmModal({
  open,
  method,
  path,
  bodySummary,
  onApprove,
  onReject,
}: Props) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onReject}
    >
      <div
        className="rounded-lg p-4 flex flex-col gap-3 max-w-md w-full mx-4"
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="text-sm font-bold" style={{ color: 'var(--text)' }}>
          Confirm Action
        </div>
        <div className="text-xs" style={{ color: 'var(--muted)' }}>
          The assistant wants to call:
        </div>
        <div
          className="text-xs px-2 py-1.5 rounded font-mono"
          style={{ background: 'var(--surface)', color: 'var(--accent)' }}
        >
          {method} {path}
        </div>
        {bodySummary && (
          <pre
            className="text-xs p-2 rounded overflow-auto max-h-40"
            style={{ background: 'var(--surface)', color: 'var(--muted)' }}
          >
            {bodySummary}
          </pre>
        )}
        <div className="flex gap-2 justify-end">
          <button
            onClick={onReject}
            className="text-xs px-3 py-1.5 rounded"
            style={{
              background: 'var(--surface)',
              color: 'var(--muted)',
              border: '1px solid var(--border)',
            }}
          >
            Reject
          </button>
          <button
            onClick={onApprove}
            className="text-xs px-3 py-1.5 rounded font-semibold"
            style={{ background: 'var(--accent)', color: 'white' }}
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  )
}
