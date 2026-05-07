// Floating button to open the global chat drawer. Hides when drawer is open
// (the drawer's own close button takes over). Shortcut hint shown in title.
import { MessageSquare } from 'lucide-react'
import { useChatDrawer } from '../../lib/chat-drawer-context'

export default function ChatTriggerButton() {
  const { open, setOpen } = useChatDrawer()
  if (open) return null
  return (
    <button
      onClick={() => setOpen(true)}
      className="fixed bottom-6 right-6 rounded-full p-3 shadow-lg transition-transform hover:scale-105"
      style={{
        background: 'var(--accent)',
        color: 'var(--bg)',
        zIndex: 30,
      }}
      title="Open chat (Cmd/Ctrl + Shift + L)"
      aria-label="Open chat"
    >
      <MessageSquare size={20} />
    </button>
  )
}
