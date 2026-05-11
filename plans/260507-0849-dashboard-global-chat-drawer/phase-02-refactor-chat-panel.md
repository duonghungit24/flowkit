# P2 — Refactor ChatPanel for Reuse

## Overview

- **Priority**: P1
- **Status**: pending
- **Effort**: ~0.4d

Extract project-agnostic chat logic from `ProjectChatPanel.tsx` into a generic
`ChatPanel.tsx` accepting `projectId: string | null`. P3 drawer + P5 ProjectDetail
button both consume this. Single source of truth.

## Key Insights

- `ProjectChatPanel.tsx` (298 lines) is a single component mixing layout + state +
  stream handling. Most logic doesn't depend on project — only localStorage key +
  `streamChat({projectId})` arg do.
- Component is already <300 lines; modularization not strictly required, but the
  prop change is non-trivial enough that a rename + clean prop boundary is worth it.
- Keep file under 200 lines per CLAUDE.md modularization rule. Currently 298 — split:
  - `ChatPanel.tsx` — layout + composition (~120 lines).
  - `use-chat-stream.ts` — hook for stream apply logic (~120 lines).
  - `use-chat-sessions.ts` — hook for session list + load/delete (~60 lines).
- Naming: PascalCase for React component files (project convention — see `ChatMessage.tsx`, `ProjectDetailPage.tsx`); kebab-case for hook/util files.

## Requirements

- New `dashboard/src/components/chat/` directory (project-agnostic).
- `ChatPanel` props: `{ projectId: string | null, initialInput?, onInitialInputConsumed?, onTurnComplete? }`.
- localStorage key: `fk-chat-session:${projectId ?? 'draft'}` — draft sessions remembered separately per "draft scope".
- Move `ChatMessage`, `ChatInput`, `ChatSessionList` from `components/projects/` → `components/chat/`. They have zero project-specific logic.
- Keep `ProjectChatPanel.tsx` as a 5-line wrapper passing `projectId` through (deleted in P5 once `ProjectDetailPage` switches to drawer button).

## Files

**Create:**
- `dashboard/src/components/chat/ChatPanel.tsx` — main composition.
- `dashboard/src/components/chat/use-chat-stream.ts` — `streamChat` event-apply hook.
- `dashboard/src/components/chat/use-chat-sessions.ts` — list/load/delete sessions.

**Move (git mv):**
- `components/projects/ChatMessage.tsx` → `components/chat/ChatMessage.tsx`.
- `components/projects/ChatInput.tsx` → `components/chat/ChatInput.tsx`.
- `components/projects/ChatSessionList.tsx` → `components/chat/ChatSessionList.tsx`.

**Modify:**
- `components/projects/ProjectChatPanel.tsx` — reduce to thin wrapper `<ChatPanel projectId={projectId} ... />`.
- `pages/ProjectDetailPage.tsx` — import path unchanged (still uses ProjectChatPanel). Updated in P5.

## Implementation Steps

1. Create `components/chat/` dir.
2. Extract `useChatStream({projectId, sessionId, onSessionChange, onRebind, onTurnComplete})` returning `{messages, streaming, error, send}`. Move `applyEvent` + state setters here. Handle new `session_rebind` event = call `onRebind(new_project_id)`.
3. Extract `useChatSessions(projectId)` returning `{sessions, refresh, load, delete: handleDelete, activeId, setActiveId}`. Migrate localStorage logic with key `fk-chat-session:${projectId ?? 'draft'}`.
4. Build `ChatPanel.tsx` composing both hooks + layout JSX from existing `ProjectChatPanel`.
5. Move 3 child components (PascalCase preserved), update internal imports.
6. Reduce `ProjectChatPanel.tsx` to wrapper. Verify `ProjectDetailPage` still renders correctly.
7. `npm run build` + `npm run lint` clean.

## Todo

- [ ] dir + hook scaffolding
- [ ] useChatStream w/ session_rebind handler stub (callback unused until P4)
- [ ] useChatSessions w/ draft-aware localStorage key
- [ ] chat-panel.tsx composition
- [ ] move 3 child components
- [ ] thin ProjectChatPanel wrapper
- [ ] build + lint pass

## Success Criteria

- `ProjectDetailPage` Chat tab renders identically to before.
- No file in `components/chat/` exceeds 200 lines.
- `streamChat` accepts `projectId: string | null` (already does at API level).
- session_rebind event triggers `onRebind` callback (verified via console.log; UI in P4).

## Risks

- **Hook ordering**: stream + sessions both touch `activeId`. Mitigation: sessions hook owns `activeId`, stream hook receives it as arg.
- **localStorage key collision**: existing per-project keys still work; `draft` scope is new. No migration needed.

## Security

- N/A (pure refactor).
