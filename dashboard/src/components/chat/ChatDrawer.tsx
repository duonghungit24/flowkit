// Right-side chat drawer mounted globally in App layout. Slides over the page
// (not push) so it doesn't disturb the underlying route. Project picker slot
// lives in the header — wired in P4.
import { X } from 'lucide-react'
import { useChatDrawer } from '../../lib/chat-drawer-context'
import ChatPanel from './ChatPanel'
import ChatProjectPicker from './ChatProjectPicker'

const DRAWER_WIDTH = 560

export default function ChatDrawer() {
  const {
    open,
    setOpen,
    activeProjectId,
    setActiveProjectId,
    refreshProjects,
    notifyRebind,
    notifyTurnComplete,
    pendingInput,
    consumePendingInput,
  } = useChatDrawer()

  const handleRebind = (newPid: string) => {
    setActiveProjectId(newPid)
    notifyRebind(newPid)
    refreshProjects().catch(() => {})
  }

  return (
    <>
      {/* Backdrop — subtle dim so chat doesn't fight with main content. */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          className="fixed inset-0 transition-opacity"
          style={{ background: 'rgba(0,0,0,0.25)', zIndex: 40 }}
          aria-hidden
        />
      )}
      <aside
        className="fixed top-0 right-0 bottom-0 flex flex-col transition-transform"
        style={{
          width: DRAWER_WIDTH,
          maxWidth: '100vw',
          background: 'var(--bg)',
          borderLeft: '1px solid var(--border)',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          zIndex: 50,
          boxShadow: open ? '-8px 0 32px rgba(0,0,0,0.25)' : 'none',
        }}
        aria-label="Chat drawer"
        aria-hidden={!open}
      >
        <header
          className="flex items-center justify-between px-4 py-3 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
            Chat
          </span>
          <button
            onClick={() => setOpen(false)}
            className="p-1 rounded hover:opacity-80"
            style={{ color: 'var(--muted)' }}
            aria-label="Close chat drawer"
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </header>

        <div
          className="px-4 py-2 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <ChatProjectPicker />
        </div>

        <div className="flex-1 overflow-hidden p-3">
          <ChatPanel
            key={activeProjectId ?? 'draft'}
            projectId={activeProjectId}
            height="100%"
            showSessionList={false}
            onRebind={handleRebind}
            onTurnComplete={notifyTurnComplete}
            initialInput={pendingInput}
            onInitialInputConsumed={consumePendingInput}
          />
        </div>
      </aside>
    </>
  )
}
