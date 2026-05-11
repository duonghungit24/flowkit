# P5 — ProjectDetailPage Integration

## Overview

- **Priority**: P2
- **Status**: pending
- **Effort**: ~0.3d

Replace the in-page Chat tab with a "Open Chat" button that opens the global
drawer pre-bound to this project. Single chat surface = no UI duplication, no
state-sync confusion.

## Key Insights

- Today's tab keeps a chat panel mounted per-project — confusing once a global
  drawer exists. Two surfaces would diverge in state.
- Button in page header is more discoverable than a tab and matches Cursor / Linear UX (chat is always one click away).
- Pre-select via `openWith(projectId)` from drawer context (added in P3).
- Removing tab = simplifies `ProjectDetailPage` (currently 400+ lines), drops `chatInitialInput` plumbing.

## Requirements

- Remove `Chat` from `Tab` union + `VALID_TABS` + `tabs` array.
- Remove `<ProjectChatPanel />` mount in tab content.
- Add "Chat about this project" button in page header (next to existing actions).
- Button onClick: `useChatDrawer().openWith(projectId)`.
- Delete `dashboard/src/components/projects/ProjectChatPanel.tsx` (was a thin wrapper after P2; nothing else imports it).
- Delete `dashboard/src/lib/last-project.ts` if it was only used for chat (verify).

## Files

**Modify:**
- `dashboard/src/pages/ProjectDetailPage.tsx` — remove Chat tab, add header button.

**Delete:**
- `dashboard/src/components/projects/ProjectChatPanel.tsx` (after verifying no other imports).

**Verify:**
- `dashboard/src/lib/last-project.ts` — check if used outside chat. If only chat, delete.

## Implementation Steps

1. `grep -rn "ProjectChatPanel\|last-project" dashboard/src` — confirm only ProjectDetailPage uses ProjectChatPanel; check `last-project.ts` callers.
2. Edit `ProjectDetailPage.tsx`:
   - Drop `import ProjectChatPanel`.
   - Drop `'Chat'` from `Tab` type, `VALID_TABS`, `tabs` array.
   - Drop `chatInitialInput` state + the entire `<div style={{display: tab === 'Chat'...}}>` block.
   - Add `import { useChatDrawer } from '../lib/chat-drawer-context'`.
   - Add header button: `<button onClick={() => openWith(project.id)}>Chat</button>` styled to match other header actions.
3. Delete `ProjectChatPanel.tsx`.
4. If `last-project.ts` only used by chat → delete + remove imports.
5. `npm run build` + `npm run lint`. Manual smoke: enter project → click Chat → drawer opens, picker shows this project, prior sessions for this project listed.

## Todo

- [ ] grep usage of ProjectChatPanel + last-project
- [ ] remove Chat tab from ProjectDetailPage
- [ ] add header "Chat" button → openWith(projectId)
- [ ] delete ProjectChatPanel.tsx
- [ ] delete last-project.ts if unused elsewhere
- [ ] build + lint + smoke test

## Success Criteria

- Project detail page no longer has Chat tab.
- "Chat" button in header opens drawer with project pre-selected.
- Existing project chat sessions still accessible (same `chat_session.project_id` rows).
- No dead code or unused imports remain.

## Risks

- **User muscle memory**: existing tab users need to relearn. Mitigation: tooltip on header button: "Open chat (Cmd+Shift+L)".
- **Deep-linked Chat tab URL**: if anyone bookmarked `?tab=Chat`, redirect to `tab=Overview` + auto-open drawer with project. Add tiny effect: `if (initialTab === 'Chat') { setTab('Overview'); openWith(projectId) }`.

## Security

- N/A.

## Unresolved Questions

- Should `Cmd+Shift+L` from inside a project default-open with that project pre-selected, or always open with last `activeProjectId`? (Lean: pre-select project when invoked from project detail page; preserve `activeProjectId` elsewhere.)
