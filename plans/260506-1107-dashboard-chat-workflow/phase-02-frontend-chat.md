# Phase 02: Frontend Chat Panel

## Context Links

- Plan overview: [plan.md](./plan.md)
- Phase 01 (required): [phase-01-backend-mvp.md](./phase-01-backend-mvp.md)
- Source inspiration: `zach94-fullstack/agent-flowkit` — `dashboard/src/components/projects/ProjectChatPanel.tsx`
- Project detail page: `dashboard/src/pages/ProjectDetailPage.tsx` (tab system, lines 296-371)
- API client pattern: `dashboard/src/api/client.ts` (fetchAPI / patchAPI)
- Types: `dashboard/src/types/index.ts`
- Dashboard stack: React 19 + Vite + Tailwind v4 (no shadcn/ui, uses CSS vars)

## Overview

- **Priority:** P1 (user-facing feature)
- **Status:** done (manual tests pending user verification)
- **Effort:** ~1 day
- **Blocker:** Phase 01 backend must be verified via curl
- **Description:** Add "Chat" tab to `ProjectDetailPage`. Includes session sidebar, streaming message bubbles with inline tool-call display, /fk-* autocomplete, and NDJSON client. No new npm packages.

## Key Insights

1. **Existing tab system** (`ProjectDetailPage.tsx:326-368`): `Tab = 'Overview' | 'Characters' | 'Videos' | 'Scenes'`. Adding `'Chat'` requires only extending the union type and adding a case in the tab content block — minimal footprint.
2. **CSS var pattern**: Dashboard uses `var(--card)`, `var(--border)`, `var(--accent)`, `var(--muted)`, `var(--text)`, `var(--green)`, `var(--yellow)`, `var(--red)` — no Tailwind color utilities. All new components must follow this pattern.
3. **Streaming**: NDJSON from `POST /api/chat` requires `fetch` with `ReadableStream` reader, not `res.json()`. The `chatApi.ts` module wraps this. Existing `client.ts` only does `fetch + res.json()` — we add a sibling file, not modify it.
4. **No npm additions**: `fetch` ReadableStream is native; TextDecoder for NDJSON parsing is native. Zero new dependencies.
5. **Session persistence**: `session_id` returned in `{"type":"done","session_id":"..."}` event. Store in component state + localStorage keyed by `projectId` so chat resumes across page reloads.
6. **Tool call display**: Collapsed by default (chevron expand). Shows `method + path` in header, expandable JSON body. Matches source UX pattern.
7. **File size rule**: `ProjectDetailPage.tsx` is already 372 lines — adding a full chat panel inline would breach 200-line limit. The `ChatTab` component must live in a separate file, imported and rendered in the tab content block.
8. **Autocomplete for /fk-***: On typing `/fk`, fetch `GET /api/library-skills` once (cached in module), show dropdown of matching skill names. Select fills input.

## Requirements

### Functional
- "Chat" tab visible on project detail page
- Send message → see streaming text response
- Tool calls shown inline as collapsible cards (method + path visible, body expandable)
- Sessions listed in left sidebar; click to switch; new chat button
- Session title auto-set from first 40 chars of first user message
- `/fk-` prefix → autocomplete dropdown from skill list
- Confirmation modal stub (P4 wires it; P2 just renders if `confirmation_required` event arrives)
- Chat input: Enter to send, Shift+Enter for newline
- Scroll-to-bottom on new messages
- Loading indicator while streaming

### Non-functional
- No new npm packages
- All CSS via existing CSS vars
- Each new file ≤ 200 lines
- TypeScript strict (no `any` except where unavoidable for stream parsing)

## Architecture

```
dashboard/src/
├── api/
│   ├── client.ts                  (existing — do NOT modify)
│   └── chat-api.ts                (new) NDJSON streaming client + session REST
├── components/
│   └── projects/
│       ├── ProjectChatPanel.tsx   (new) top-level chat tab component
│       ├── ChatSessionList.tsx    (new) session sidebar
│       ├── ChatMessage.tsx        (new) message bubble + tool-call display
│       ├── ChatInput.tsx          (new) textarea + /fk autocomplete
│       └── shared/
│           └── ConfirmModal.tsx   (new) confirmation modal (stub for P4)
└── pages/
    └── ProjectDetailPage.tsx      (modify) add 'Chat' tab
```

### Component Data Flow

```
ProjectDetailPage
  └── ProjectChatPanel (projectId prop)
        ├── ChatSessionList
        │     sessions[], activeSessionId, onSelect, onNew
        ├── messages[] rendered as ChatMessage[]
        │     ChatMessage: role, content, toolCalls[]
        │     └── ToolCallCard (collapsed by default)
        └── ChatInput
              onSend(text) → chatApi.streamChat(...)
              → yields NdjsonEvent → updates messages[]
              → on done: saves session_id to state + localStorage
```

### Types to Add (`types/index.ts`)

```typescript
export interface ChatSession {
  id: string
  project_id: string
  title: string
  model: string
  created_at: string
  updated_at: string
}

export interface ChatMessageRecord {
  id: string
  session_id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  tool_calls: string | null  // JSON string
  created_at: string
}

export interface ToolCallDisplay {
  id: string
  name: string
  method: string
  path: string
  body?: string
  result?: string
}

export type NdjsonEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; id: string; name: string; args: string }
  | { type: 'tool_result'; id: string; content: string }
  | { type: 'confirmation_required'; tool_call_id: string; method: string; path: string; body_summary: string }
  | { type: 'error'; content: string }
  | { type: 'done'; session_id: string }
```

### `chat-api.ts` Key Functions

```typescript
// NDJSON streaming
export async function* streamChat(
  messages: {role: string; content: string}[],
  projectId: string,
  sessionId: string | null,
): AsyncGenerator<NdjsonEvent>

// Session REST
export async function listSessions(projectId: string): Promise<ChatSession[]>
export async function getSession(sid: string): Promise<{session: ChatSession; messages: ChatMessageRecord[]}>
export async function deleteSession(sid: string): Promise<void>
```

`streamChat` implementation outline:
```typescript
const res = await fetch('/api/chat', {method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({messages, project_id: projectId, session_id: sessionId})})
const reader = res.body!.getReader()
const decoder = new TextDecoder()
let buf = ''
while (true) {
  const {done, value} = await reader.read()
  if (done) break
  buf += decoder.decode(value, {stream: true})
  const lines = buf.split('\n')
  buf = lines.pop()!
  for (const line of lines) {
    if (line.trim()) yield JSON.parse(line) as NdjsonEvent
  }
}
```

## Related Code Files

### Files to Modify
- `dashboard/src/pages/ProjectDetailPage.tsx`
  - Line 6: extend `Tab` type → `'Overview' | 'Characters' | 'Videos' | 'Scenes' | 'Chat'`
  - Line 326: add `'Chat'` to `tabs` array
  - Line 364-368: add `{tab === 'Chat' && <ProjectChatPanel projectId={projectId} />}` in tab content
  - Add import for `ProjectChatPanel`
- `dashboard/src/types/index.ts`
  - Append `ChatSession`, `ChatMessageRecord`, `ToolCallDisplay`, `NdjsonEvent` types

### Files to Create
- `dashboard/src/api/chat-api.ts`
- `dashboard/src/components/projects/ProjectChatPanel.tsx`
- `dashboard/src/components/projects/ChatSessionList.tsx`
- `dashboard/src/components/projects/ChatMessage.tsx`
- `dashboard/src/components/projects/ChatInput.tsx`
- `dashboard/src/components/shared/ConfirmModal.tsx`

### Files NOT to Touch
- `dashboard/src/api/client.ts` — existing fetch utils, no modification
- `dashboard/src/App.tsx` — routing unchanged

## Implementation Steps

1. **Types** (`dashboard/src/types/index.ts`)
   - Append the 4 new interfaces + `NdjsonEvent` union at end of file

2. **`chat-api.ts`** (new, ≤120 lines)
   - `streamChat` async generator
   - `listSessions`, `getSession`, `deleteSession` using existing `fetchAPI` pattern from `client.ts`
   - `listSkills` — fetch `GET /api/library-skills`, cache result in module-level var

3. **`ConfirmModal.tsx`** (new, ≤60 lines)
   - Props: `open`, `method`, `path`, `bodySummary`, `onApprove`, `onReject`
   - Simple modal overlay using CSS vars
   - P2 stub: renders if `open=true` but P4 wires actual approve/reject calls

4. **`ChatMessage.tsx`** (new, ≤120 lines)
   - Props: `role`, `content`, `toolCalls: ToolCallDisplay[]`
   - User messages: right-aligned, `var(--accent)` border
   - Assistant messages: left-aligned, `var(--card)` bg
   - Tool call cards: collapsible, show `METHOD /path` in header
   - Markdown-lite: render `**bold**` and `` `code` `` inline (no markdown lib, use regex replace)

5. **`ChatInput.tsx`** (new, ≤100 lines)
   - Controlled textarea, `onSend(text)` callback
   - Enter → send, Shift+Enter → newline
   - `/fk-` typed → fetch skills (lazy, cached) → show dropdown
   - Skill selected → replace input with `/fk-<name> `
   - Disabled while `isStreaming`

6. **`ChatSessionList.tsx`** (new, ≤80 lines)
   - Props: `sessions`, `activeId`, `onSelect`, `onNew`, `onDelete`
   - Scrollable list, each item shows `session.title` + date
   - "New Chat" button at top
   - Delete button (trash icon via Unicode `🗑` or `×`)

7. **`ProjectChatPanel.tsx`** (new, ≤180 lines)
   - State: `sessions`, `activeSessionId`, `messages` (local display list), `isStreaming`, `confirmEvent`
   - On mount: `listSessions(projectId)` → restore last `sessionId` from localStorage
   - On session select: `getSession(sid)` → hydrate `messages` from history
   - `handleSend(text)`:
     - Append user message to local `messages`
     - Call `streamChat(...)` async generator
     - For each `NdjsonEvent`:
       - `text` → append delta to last assistant bubble (or create new)
       - `tool_call` → append tool call display card
       - `tool_result` → attach result to matching tool call card
       - `confirmation_required` → set `confirmEvent` state → `ConfirmModal` opens (P4 logic)
       - `error` → show error bubble
       - `done` → save `session_id`, refresh session list, set `isStreaming=false`
   - Scroll ref: `useEffect` on messages → `scrollRef.current?.scrollIntoView()`

8. **Wire into `ProjectDetailPage.tsx`**
   - Add `'Chat'` to Tab type and tabs array
   - Import `ProjectChatPanel`, render in tab content

9. **Build check**:
   ```bash
   cd /Users/mesoft/Project/AI/flowkit/dashboard && npm run build
   ```
   Must complete with 0 TypeScript errors.

10. **Dev test**:
    ```bash
    cd /Users/mesoft/Project/AI/flowkit/dashboard && npm run dev
    # Open http://localhost:5173, navigate to a project, click Chat tab
    # Type "list my videos" → should see streaming response
    ```

## Todo List

- [x] Add types to `dashboard/src/types/index.ts`
- [x] Create `dashboard/src/api/chat-api.ts`
- [x] Create `dashboard/src/components/shared/ConfirmModal.tsx` (stub)
- [x] Create `dashboard/src/components/projects/ChatMessage.tsx`
- [x] Create `dashboard/src/components/projects/ChatInput.tsx`
- [x] Create `dashboard/src/components/projects/ChatSessionList.tsx`
- [x] Create `dashboard/src/components/projects/ProjectChatPanel.tsx`
- [x] Modify `dashboard/src/pages/ProjectDetailPage.tsx` (Tab type + tabs array + render)
- [x] Modify `dashboard/src/types/index.ts` (append types)
- [x] `npm run build` — 0 errors **on phase-02 files** (pre-existing `LogsPage.tsx` → missing `components/logs/LogViewer` import is unrelated; tracked separately)
- [ ] Manual test: Chat tab renders, sends message, sees streaming response
- [ ] Manual test: session persists across page reload (localStorage)
- [ ] Manual test: /fk- autocomplete shows skill list

## Success Criteria

- Chat tab visible in project detail page
- User sends "list my projects" → streaming text response appears with tool_call + tool_result cards
- Session ID preserved in localStorage; reload → chat history restored
- `npm run build` exits 0 (no TS errors)
- `npm run lint` exits 0 (or only pre-existing warnings)

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `ProjectDetailPage.tsx` grows beyond 200 lines after modification | High | Low | Tab content is a single import + render line; actual panel lives in `ProjectChatPanel.tsx` |
| NDJSON stream parsing breaks on partial chunk boundaries | Medium | High | Buffer-split pattern in `chat-api.ts` handles chunk boundaries correctly (lines split on `\n`) |
| Autocomplete dropdown conflicts with textarea focus | Low | Low | Use `onMouseDown` on dropdown items (prevents blur before click) |
| Tool call JSON display overflows small screens | Low | Low | Truncate body display at 200 chars with "show more" toggle |
| Session history fetch slow on many messages | Low | Low | `list_chat_messages` limited to last 30 in backend |

## Security Considerations

- No auth on dashboard (same as existing — loopback only)
- User input displayed as text, not `dangerouslySetInnerHTML` — no XSS from LLM output
- Tool call results shown read-only; never eval'd
- `ConfirmModal` (P4) blocks destructive ops at UI level

## Next Steps

- P4 (guardrails) wires `ConfirmModal.tsx` to real `/api/chat/confirm` endpoint
- P4 adds `confirmation_required` event handling in `ProjectChatPanel.tsx` (approveConfirm / rejectConfirm)
