# P3 — Drawer Shell + Floating Trigger

## Overview

- **Priority**: P1
- **Status**: pending
- **Effort**: ~0.5d

Add a right-side drawer that mounts `ChatPanel` globally + a floating button to
toggle it. Drawer is a single instance at `App` level — same chat state survives
route changes (Dashboard → Projects → Library) so user never loses context.

## Key Insights

- Drawer must persist across navigation → mount in `App.tsx` outside `<Routes>`.
- Don't use a modal — chat needs to coexist with the page (user reads gallery while AI generates). Drawer overlays only the right portion.
- Width: ~440px on desktop, full-screen on mobile (Tailwind responsive).
- Open state: ephemeral in memory + `localStorage` flag `fk-chat-drawer-open` so it stays open across reload (matches Cursor / VS Code chat panel UX).
- Floating button: hide when drawer is open (avoid overlap). Position: `fixed bottom-6 right-6`.
- A11y: `Esc` closes drawer, `Cmd/Ctrl+Shift+L` toggles (familiar from agent IDEs).

## Requirements

- New `dashboard/src/components/chat/ChatDrawer.tsx` — the drawer chrome (header + close + ChatPanel slot).
- New `dashboard/src/components/chat/ChatTriggerButton.tsx` — floating button.
- New context `dashboard/src/lib/chat-drawer-context.tsx` — `{ open, toggle, openWith(projectId) }` so other UI (P5 ProjectDetailPage button) can open the drawer pre-bound to a project.
- Mount in `App.tsx` Layout: provider + drawer + button.
- ChatPanel inside drawer receives `projectId` from context state (initialized to `null` = Draft).

## Files

**Create:**
- `dashboard/src/components/chat/ChatDrawer.tsx` (~80 lines).
- `dashboard/src/components/chat/ChatTriggerButton.tsx` (~30 lines).
- `dashboard/src/lib/chat-drawer-context.tsx` (~50 lines).

**Modify:**
- `dashboard/src/App.tsx` — wrap Layout in `<ChatDrawerProvider>`, render `<ChatDrawer />` + `<ChatTriggerButton />` inside Layout.

## Implementation Steps

1. `chat-drawer-context.tsx`: React context with `open`, `setOpen`, `activeProjectId`, `setActiveProjectId`. Persist `open` + `activeProjectId` to localStorage. Expose `useChatDrawer()` hook + `openWith(projectId: string | null)` convenience.
2. `ChatDrawer.tsx`: fixed-position panel `right-0 top-0 bottom-0 w-[440px]`, slide transition (Tailwind `translate-x-full` ↔ `translate-x-0`). Header w/ close button. Body = `<ChatPanel projectId={activeProjectId} />`.
   - Project picker (P4) gets a slot in the header.
3. `ChatTriggerButton.tsx`: round button `bottom-6 right-6`, `MessageSquare` icon, hides when `open`. Click → `setOpen(true)`.
4. Keyboard handlers in provider: `Esc` close, `Cmd/Ctrl+Shift+L` toggle. Use single window listener.
5. Mount in `App.tsx`. Verify drawer survives navigation.
6. Manual smoke: open drawer on Dashboard → navigate to Projects → drawer still open + same chat state.

## Todo

- [ ] context + provider + localStorage persistence
- [ ] keyboard shortcuts
- [ ] ChatDrawer chrome + slide animation
- [ ] ChatTriggerButton floating
- [ ] Mount in App.tsx
- [ ] cross-route persistence smoke test

## Success Criteria

- Drawer accessible from any route via floating button or shortcut.
- Drawer state survives navigation between Dashboard/Projects/Library/Logs/Gallery.
- Drawer state (open + active project) restored on reload.
- No layout shift on main page when drawer opens (overlay, not push).

## Risks

- **z-index war**: drawer must be above page content but below browser chrome. Use `z-50`.
- **Mobile**: 440px drawer covers most of viewport. OK for MVP; full-screen tweak later.
- **Animation jank**: use CSS transition `transform` only (composited).

## Security

- N/A.
