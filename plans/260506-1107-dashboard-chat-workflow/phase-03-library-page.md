# Phase 03: Library Page

## Context Links

- Plan overview: [plan.md](./plan.md)
- Phase 01 (required): [phase-01-backend-mvp.md](./phase-01-backend-mvp.md) — provides `GET /api/library-skills`
- Phase 02 (required): [phase-02-frontend-chat.md](./phase-02-frontend-chat.md) — provides `chat-api.ts` listSkills cache
- Source inspiration: `zach94-fullstack/agent-flowkit` — `dashboard/src/pages/LibraryPage.tsx`
- Existing routing: `dashboard/src/App.tsx` (NavLink + Routes pattern, react-router-dom v7)
- Materials API (existing): `agent/api/materials.py`
- Skill files: `skills/fk-*.md` (~36 skills, parsed via `skill_executor.list_skills()` from P1)

## Overview

- **Priority:** P3 (UX enhancement, not blocking)
- **Status:** done
- **Effort:** ~1 day
- **Blocker:** P1 (`GET /api/library-skills` endpoint) + P2 (chat panel for "Run in chat" action)
- **Description:** New top-level `/library` route. Two tabs: **Skills** (catalog of all `/fk-*` skills with descriptions, grouped by pipeline stage, "Run in chat" action) and **Materials** (browse uploaded reference images/videos used by characters/locations). Solves "user doesn't know which skill to call" — discoverability for non-dev users.

## Key Insights

1. **Top-level route, not project-scoped**: skills and materials are global resources, not tied to a specific project. New nav item next to `Projects`/`Logs`/`Gallery`.
2. **Skill grouping**: skills declare their pipeline stage in metadata. Default groups: `Setup`, `Generation`, `Audio`, `Post-process`, `QA/Review`, `Utility`. Group inferred from filename prefix or explicit `stage:` metadata field.
3. **"Run in chat" action**: clicking Run on a skill card → navigate to last-active project's chat tab + prefill input with `/fk-<name> ` (trailing space for args). No need for separate form UI.
4. **Materials reuse existing API**: `GET /api/materials` already exists. P3 adds read-only browser; upload UI deferred (already accessible via project detail).
5. **Search box** filters across name + description. Simple `String.includes` (no fuzzy lib needed).
6. **No new backend work** beyond P1's `GET /api/library-skills`. Materials endpoint already exists.
7. **File size compliance**: `LibraryPage.tsx` will exceed 200 lines if monolithic. Split into `SkillsTab.tsx` + `MaterialsTab.tsx` + `SkillCard.tsx`.

## Requirements

### Functional
- `/library` accessible from main nav (NavLink in `App.tsx`)
- Tabs: **Skills** (default) | **Materials**
- Skills tab:
  - Grouped sections by stage with collapsible headers
  - Each skill shows: name, usage line, description, tags
  - Search box filters live (name + description)
  - "Run in chat" button → opens last project + prefills `/fk-<name> ` in chat input
  - "Copy command" button → copies `/fk-<name>` to clipboard
- Materials tab:
  - List view: thumbnail, filename, type (image/video), size, used-by count
  - Filter by type (image/video/audio) + search by filename
  - Click item → modal with full preview + metadata
- Empty states for both tabs

### Non-functional
- No new npm deps (image preview via `<img>`, video via `<video>`)
- File size: each new component ≤ 200 lines
- Search: client-side, debounced 200ms
- Skill list cached in module (already done by `chat-api.ts:listSkills()`)

## Architecture

```
dashboard/src/
├── pages/
│   └── LibraryPage.tsx              (new) tab container, top-level route
├── components/
│   └── library/
│       ├── SkillsTab.tsx            (new) skills catalog + search + groups
│       ├── SkillCard.tsx            (new) single skill display + actions
│       ├── MaterialsTab.tsx         (new) materials browser + filter
│       └── MaterialPreviewModal.tsx (new) full preview modal
├── api/
│   └── chat-api.ts                  (modify) extend listSkills response shape with `stage`/`tags`
├── App.tsx                          (modify) add NavLink + Route for /library
└── lib/
    └── lastProject.ts               (new) localStorage helper for "last active project"
```

### Skill Grouping Logic

Backend (`skill_executor.list_skills()` from P1) returns:
```json
[
  {"name": "fk-create-project", "usage": "/fk-create-project <name>", "description": "...", "stage": "setup", "tags": ["project"]},
  {"name": "fk-gen-images",     "usage": "/fk-gen-images <vid>",      "description": "...", "stage": "generation", "tags": ["scene"]},
  {"name": "fk-concat",         "usage": "/fk-concat <vid> [--with-tts]","description":"...", "stage": "post-process", "tags": ["video"]}
]
```

Stage inference (in `skill_executor.list_skills()`):
- `fk-create-*`, `fk-add-*` → `setup`
- `fk-gen-*` → `generation`
- `fk-tts-*`, `fk-music-*`, `fk-narrator*` → `audio`
- `fk-concat*`, `fk-upscale*`, `fk-pipeline` → `post-process`
- `fk-review-*`, `fk-doctor` → `qa-review`
- everything else → `utility`

### "Run in Chat" Flow

```
User clicks [Run in chat] on /fk-pipeline card
        ↓
read localStorage `last-project-id`
        ↓
navigate(`/projects/${projectId}?tab=Chat&skill=fk-pipeline`)
        ↓
ProjectDetailPage reads ?tab + ?skill query params
        ↓
sets activeTab='Chat' + chat input prefilled with "/fk-pipeline "
```

If no last project: show toast "Open a project first" + navigate to `/projects`.

### Materials Tab Architecture

Reuse existing `GET /api/materials`. Returns:
```json
[{"id": "uuid", "filename": "boat.jpg", "type": "image", "size": 234567, "url": "/files/...", "used_by_count": 3}]
```

Filter chips: `[All] [Image] [Video] [Audio]` + search input.

Grid layout: 4 cols on desktop, 2 cols mobile. Each card: thumbnail (64x64 for image/video first frame), filename truncated, type badge.

Click card → `MaterialPreviewModal`:
- Full-size preview
- Metadata: type, size, dimensions (for image/video), duration (video/audio)
- Used-by list (which characters/scenes reference this material)
- Copy media_id to clipboard

## Related Code Files

### Files to Modify
- `dashboard/src/App.tsx` — add NavLink + Route for `/library`
- `dashboard/src/api/chat-api.ts` — extend `listSkills` response type with `stage` + `tags`
- `dashboard/src/pages/ProjectDetailPage.tsx` — read `?tab=Chat&skill=...` query params, prefill chat input
- `agent/services/skill_executor.py` (from P1) — add `stage` inference + `tags` parsing in `list_skills()`

### Files to Create
- `dashboard/src/pages/LibraryPage.tsx`
- `dashboard/src/components/library/SkillsTab.tsx`
- `dashboard/src/components/library/SkillCard.tsx`
- `dashboard/src/components/library/MaterialsTab.tsx`
- `dashboard/src/components/library/MaterialPreviewModal.tsx`
- `dashboard/src/lib/lastProject.ts` (~20 lines, localStorage getter/setter)

### Files NOT to Touch
- `agent/api/materials.py` — existing endpoint sufficient
- `agent/api/skills.py` (from P1) — only `skill_executor.py` adds metadata fields

## Implementation Steps

1. **Backend: extend skill metadata** (`agent/services/skill_executor.py` from P1)
   - Add `_infer_stage(name: str) -> str` helper with prefix mapping
   - Parse optional `tags: [a,b]` line in skill `.md` frontmatter (best-effort, default `[]`)
   - Update `list_skills()` return shape to include `stage` + `tags`

2. **Frontend types** (`dashboard/src/types/index.ts`)
   - Extend `Skill` interface: `stage: string`, `tags: string[]`
   - Add `Material` interface: `id, filename, type, size, url, used_by_count`

3. **`lib/lastProject.ts`** (≤30 lines)
   - `getLastProjectId(): string | null` — read localStorage `flowkit-last-project`
   - `setLastProjectId(id: string)` — write
   - Hook `useLastProject()` — wraps with React state

4. **`SkillCard.tsx`** (≤120 lines)
   - Props: `skill: Skill`, `onRunInChat: (name) => void`, `onCopy: (cmd) => void`
   - CSS vars styling (matches existing dashboard)
   - Two action buttons: Run in chat + Copy command
   - Tag pills below description

5. **`SkillsTab.tsx`** (≤150 lines)
   - Fetch via `chatApi.listSkills()` (already cached)
   - Group by `stage`, render collapsible sections
   - Search input: debounced 200ms, filters name+description+tags
   - Empty state: "No skills match your search"
   - "Run in chat" handler:
     - Read `getLastProjectId()` → if null, toast + navigate to `/projects`
     - Else: `navigate(\`/projects/${pid}?tab=Chat&skill=${name}\`)`

6. **`MaterialPreviewModal.tsx`** (≤100 lines)
   - Props: `material: Material | null`, `onClose: () => void`
   - Render preview by type (img/video/audio)
   - Metadata table + copy-id button

7. **`MaterialsTab.tsx`** (≤180 lines)
   - Fetch from `/api/materials` via existing `client.ts` `fetchAPI`
   - Filter chips + search input
   - Grid layout (CSS grid, 4/2 cols responsive)
   - Click card → set selected material → open modal

8. **`LibraryPage.tsx`** (≤80 lines)
   - Tab switcher (Skills | Materials)
   - Render selected tab
   - Page title + breadcrumb

9. **`App.tsx`** modifications
   - Add `<NavLink to="/library">Library</NavLink>` next to existing nav items
   - Add `<Route path="/library" element={<LibraryPage />} />`
   - Import `LibraryPage`

10. **`ProjectDetailPage.tsx`** modifications (reads ?skill query param)
    - `useSearchParams()` from react-router-dom
    - On mount: if `tab` param present → set active tab; if `skill` param present → set initial chat input value to `/fk-${skill} `
    - Pass initial input value as prop to `ProjectChatPanel`

11. **`ProjectChatPanel.tsx`** (small change from P2)
    - Accept `initialInput?: string` prop
    - On mount: if provided, set `chatInputValue` state to it

12. **Build check**: `cd dashboard && npm run build` → 0 errors

13. **Manual test**:
    - Open `/library` → see skills grouped by stage
    - Search "narrator" → only narrator skills visible
    - Click "Run in chat" on `/fk-pipeline` → navigate to last project, Chat tab active, input prefilled
    - Click Materials tab → see thumbnails grid
    - Click a material → modal opens with preview + metadata
    - Filter chips: only images shows correctly

## Todo List

- [x] Extend `skill_executor.list_skills()` with `stage` + `tags`
- [x] Add `Skill.stage`, `Skill.tags`, `Material` to `types/index.ts`
- [x] Create `lib/last-project.ts` (localStorage helper) — kebab-case for non-component file
- [x] Create `SkillCard.tsx`
- [x] Create `SkillsTab.tsx` with grouping + search
- [x] Create `MaterialPreviewModal.tsx`
- [x] Create `MaterialsTab.tsx` with filter chips + grid
- [x] Create `LibraryPage.tsx` tab container
- [x] Modify `App.tsx` — NavLink + Route
- [x] Modify `ProjectDetailPage.tsx` — read `?tab` and `?skill` params, sanitize skill, persist last-project-id
- [x] Modify `ProjectChatPanel.tsx` + `ChatInput.tsx` — accept `initialInput` / `initialValue` prop
- [x] Extract `useDebounce` to shared hook (`lib/use-debounce.ts`) — addresses code review DRY note
- [x] `tsc -b --noEmit` passes for phase-03 files (only pre-existing `LogsPage.tsx` import error remains, tracked separately)
- [x] `npm run lint` clean for phase-03 files
- [x] Backend tests: 73/73 pass (excluding pre-existing failures in `test_processor.py` + `test_result_handler.py`)
- [ ] Manual test: skill catalog displays + search works + "Run in chat" navigates correctly
- [ ] Manual test: materials grid + filter + preview modal

## Success Criteria

- `/library` route loads with Skills tab active
- All `fk-*` skills visible, grouped by pipeline stage
- Search filters list live (200ms debounce)
- "Run in chat" button on a skill navigates to last-used project, opens Chat tab, prefills input with `/fk-<name> `
- "Copy command" copies `/fk-<name>` to clipboard
- Materials tab shows grid of all uploaded materials with thumbnails
- Material click opens preview modal with metadata + media_id
- `npm run build` exits 0 (no TypeScript errors)

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `last-project-id` localStorage absent on fresh user | Medium | Low | Toast + redirect to `/projects` (graceful degrade) |
| Materials API returns thousands of items, page slow | Low | Medium | Paginate or virtualize list if `materials.length > 200` |
| Skill stage inference wrong for new skills | Low | Low | Default to `utility` group; users can re-classify in skill `.md` metadata |
| Video thumbnail in grid needs first-frame extraction | Medium | Low | Use `<video>` with `preload="metadata"` and `poster` if available; fallback: type icon |
| Query param `?skill=` not sanitized | Low | High (if injected into innerHTML) | Use as state value only; never inject as HTML; chat input is `<textarea>` (safe) |

## Security Considerations

- `?skill=` query param flows into chat input as string, not HTML — no XSS
- Materials preview URLs come from existing `/api/materials` (already trusted)
- `media_id` copy uses `navigator.clipboard.writeText` (modern browsers, no eval)
- No new endpoints exposed — reuses P1's `/api/library-skills` + existing `/api/materials`

## Next Steps

- Future: skill execution form UI (parse skill `.md` for `Usage:` line, generate form fields per arg)
- Future: materials upload from Library page (currently only via project detail)
- Future: filter skills by tag (multi-select)
- Future: pinned/favorite skills section at top

## Implementation Notes (post-build)

- **Plan deviation — Materials concept**: plan described Materials tab as a "browser of uploaded reference images/videos with thumbnails / used-by counts." The actual `/api/materials` endpoint returns visual style descriptors (`style_instruction`, `lighting`, `negative_prompt`, `scene_prefix`, `is_builtin`), not file metadata. Implemented Materials tab against the real API: cards show name, ID, style_instruction excerpt, builtin/custom badge; preview modal shows full instruction + lighting + scene_prefix + negative_prompt + Copy ID. No backend changes (YAGNI). Future "uploaded files browser" is a different feature requiring its own endpoint.
- **File naming**: React components use PascalCase (`SkillCard.tsx`, `LibraryPage.tsx`) to match dashboard convention (`ProjectChatPanel.tsx`, `EditableText.tsx`); helper modules use kebab-case (`last-project.ts`, `use-debounce.ts`) per global rule.
- **Stage inference ordering**: `_infer_stage` checks audio prefixes (`gen-music`, `gen-tts`, `gen-narrator`) before generic `gen-` so audio skills don't fall through to "generation". Verified across all 34 skills.
- **Query param flow**: `?tab=Chat&skill=fk-foo` → `ProjectDetailPage` reads via `useSearchParams`, sanitizes skill against `[^a-zA-Z0-9_-]`, sets `chatInitialInput` state, then strips params from URL via `setSearchParams(..., { replace: true })` so reload doesn't re-prefill. Prop flows: `ProjectDetailPage` → `ProjectChatPanel.initialInput` → `ChatInput.initialValue`. `onInitialValueConsumed` callback clears parent state after one-shot prefill.
- **Code review fixes applied**: dropped showToast-then-navigate race (toast unmounted before paint, just redirect); cleaned up toast `setTimeout` on unmount via ref; sanitized `?skill=` param; added Escape-key + ARIA dialog attrs to `MaterialPreviewModal`; guarded `lighting` field for empty strings; extracted duplicated `useDebounce` to shared `lib/use-debounce.ts`.
- **Pre-existing build error**: `LogsPage.tsx` imports a missing `components/logs/LogViewer` — confirmed via `git stash` to predate phase-03. Tracked separately per phase-02 note.
