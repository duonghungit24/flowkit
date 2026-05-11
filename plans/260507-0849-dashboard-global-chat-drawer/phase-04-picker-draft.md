# P4 — Project Picker + Draft Mode + Auto-Rebind

## Overview

- **Priority**: P1
- **Status**: pending
- **Effort**: ~0.5d

Add the project dropdown at top of the drawer + handle the `session_rebind`
event from P1 to live-switch the picker when `/fk-create-project` succeeds.

## Key Insights

- "Draft" is the picker value when `activeProjectId === null` — labeled visibly so user knows soft-project state.
- Sort projects by `updated_at` desc (last-touched first); cap at 50 in the
  dropdown (full list available via Projects page).
- Picker change = switch `activeProjectId` in context. ChatPanel re-renders, hooks re-load sessions for that scope. Same UX as switching channels in Slack.
- Auto-rebind = when `session_rebind` event fires and current `activeProjectId === null`, set `activeProjectId` to the new project_id. Visible side-effect: dropdown switches from "Draft" to the new project name. Done.

## Requirements

- New `dashboard/src/components/chat/ChatProjectPicker.tsx` — dropdown component.
- `useChatStream` hook (P2) wires `session_rebind` → callback `onRebind(new_project_id)` → drawer context `setActiveProjectId(new_project_id)`.
- Existing `projects-api.ts` `listProjects()` reused; pre-fetched once when drawer opens (cached in context for ~30s).
- Picker UI:
  - Native `<select>` for MVP (no new deps). Custom combobox is YAGNI — revisit if user requests search.
  - First option `[Draft]` (italic muted color).
  - Followed by projects sorted by `updated_at` desc.

## Files

**Create:**
- `dashboard/src/components/chat/ChatProjectPicker.tsx` (~60 lines).

**Modify:**
- `dashboard/src/lib/chat-drawer-context.tsx` — add projects cache + `refreshProjects()` + `onRebind` plumbing.
- `dashboard/src/components/chat/ChatDrawer.tsx` — render `<ChatProjectPicker />` in header.
- `dashboard/src/components/chat/use-chat-stream.ts` (P2 file) — wire `session_rebind` → `onRebind` callback.

## Implementation Steps

1. Extend drawer context: `projects: Project[]`, `refreshProjects()`, last-fetched timestamp. Fetch on first drawer open + on `session_rebind`.
2. `ChatProjectPicker`: native select bound to `activeProjectId`. `value` = `''` when null (Draft). On change, call `setActiveProjectId(value || null)`.
3. Mount picker in `ChatDrawer` header (above `ChatPanel`).
4. Pass `onRebind` callback from drawer → `ChatPanel` → `useChatStream`. Body of callback: `setActiveProjectId(newId); refreshProjects()`.
5. Toast/feedback when rebind fires (small banner in drawer header for ~3s: "Switched to project: <name>"). Optional but improves UX feedback. Use simple state + setTimeout, no toast lib.
6. Verify draft scope persists: select Draft → reload → drawer reopens to Draft + last draft session restored (P2 localStorage scope).

## Todo

- [ ] projects cache in context
- [ ] ChatProjectPicker (native select)
- [ ] mount in drawer header
- [ ] wire session_rebind → setActiveProjectId
- [ ] rebind toast banner
- [ ] manual e2e: Draft → "create project Foo" → picker switches to Foo, transcript intact

## Success Criteria

- User can switch projects without leaving drawer.
- Draft session persists across reload (localStorage key from P2 already supports this).
- `/fk-create-project` from Draft auto-switches picker to new project.
- Transcript continuity: messages before rebind remain visible after rebind.

## Risks

- **Stale projects list**: after creating a project via chat, picker must show it. Mitigation: `refreshProjects` is called as part of rebind flow.
- **Session list churn**: switching project triggers `useChatSessions` to refetch — small flicker. Acceptable.

## Security

- N/A — projects list endpoint already public on local agent.
