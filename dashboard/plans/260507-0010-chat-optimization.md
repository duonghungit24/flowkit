# Chat Optimization Plan

**Branch:** `feat_dashboard`
**Created:** 2026-05-07
**Status:** Pending — implement tomorrow

## Goal

Optimize chat UX:
1. Chat phải dùng được mọi nơi, không bị trói trong Project Detail tab
2. Chat survives navigation (không mất stream khi đổi route/tab)
3. Chọn project hoặc tạo project mới ngay trong chat
4. Gửi ảnh để hỏi Claude (multimodal Q&A, không liên quan character)

## Approach (path tối giản)

Render `ProjectChatPanel` ở **App level** dưới dạng right-side drawer, toggle bằng button. State giữ trong component (không unmount khi đổi route → không cần Context).

## Scope

Tổng ~350-450 dòng. Không touch logic streaming hiện tại (đang chạy ổn).

### 1. Floating chat drawer (~150 dòng)

- File mới: `dashboard/src/components/chat/ChatDrawer.tsx`
- Slide-in từ phải, width ~480px, height full viewport
- Toggle button ở top header của App layout (icon: MessageSquare)
- Z-index cao, overlay khi mở (mobile) hoặc push content (desktop)
- Hotkey `Cmd+K` / `Ctrl+K` toggle
- Drawer luôn mount → state survive navigation

### 2. Project selector (~80 dòng)

- File mới: `dashboard/src/components/chat/ChatProjectPicker.tsx`
- Dropdown ở header drawer, hiển thị project hiện tại
- 3 options:
  - List all projects (fetch `GET /api/projects`)
  - **"+ New project (lazy)"** → set chat về `project_id=null`, không call API
  - **"No project"** → free-form chat, `project_id=null`
- Lưu lựa chọn vào localStorage `fk-chat-active-project`
- Khi switch project → reload sessions của project đó

### 3. Lazy bind backend (~30 dòng)

- File: `agent/api/chat.py`
- Sau mỗi `tool_result` trong stream, parse:
  - Nếu tool là `POST /api/projects` (hoặc `Bash` chạy curl tạo project)
  - Status 2xx
  - Session hiện tại có `project_id IS NULL`
  - → Extract `project_id` từ response → `UPDATE chat_session SET project_id=?`
  - → Emit NDJSON event `{type: "session_bound", project_id, project_name}`
- Chỉ bind **lần đầu**, không rebind nếu session đã có project_id
- Frontend nhận `session_bound` → update dropdown + show toast "Linked to project X"

### 4. Image upload (multimodal Q&A) (~120 dòng)

#### Frontend (~70 dòng)

- File: `dashboard/src/components/projects/ChatInput.tsx`
- Thêm:
  - Nút 📎 attach file
  - Drag/drop overlay
  - Paste from clipboard (`onPaste` event)
- Đọc file → base64 → preview thumbnail trong input area (có nút X xóa)
- Hard limits: max 4MB/ảnh, max 4 ảnh/turn
- MIME whitelist: `image/png`, `image/jpeg`, `image/gif`, `image/webp`

#### Backend (~50 dòng)

- File: `agent/api/chat.py` + `agent/services/llm_bridge.py`
- `/api/chat` body thêm field:
  ```json
  {
    "messages": [...],
    "attachments": [
      {"type": "image", "media_type": "image/png", "data": "<base64>"}
    ]
  }
  ```
- `llm_bridge.py` build Anthropic content blocks cho message cuối:
  ```json
  {
    "role": "user",
    "content": [
      {"type": "image", "source": {"type": "base64", "media_type": "...", "data": "..."}},
      {"type": "text", "text": "<user question>"}
    ]
  }
  ```
- **Không persist** ảnh vào DB — transient, chỉ tồn tại trong context turn đó
- Nếu LLM không phải Claude (fallback) → return error 400 "image not supported by current model"

### 5. Project Detail Chat tab refactor (~10 dòng)

- File: `dashboard/src/pages/ProjectDetailPage.tsx`
- Tab "Chat" thay nội dung bằng button "Open chat for this project" → mở drawer + auto-select project_id của project đang xem
- Hoặc giữ nguyên panel inline + drawer là copy thứ 2 → quyết định khi implement (recommend: bỏ inline, thay bằng button cho rõ ràng)

## Files affected

### New
- `dashboard/src/components/chat/ChatDrawer.tsx`
- `dashboard/src/components/chat/ChatProjectPicker.tsx`

### Modified
- `dashboard/src/App.tsx` — toggle button + drawer mount + hotkey
- `dashboard/src/components/projects/ProjectChatPanel.tsx` — accept dynamic projectId, expose project switcher integration
- `dashboard/src/components/projects/ChatInput.tsx` — image attach UI
- `dashboard/src/api/chat-api.ts` — extend `streamChat` to send attachments
- `dashboard/src/types/index.ts` — add `ChatAttachment`, `SessionBoundEvent` types
- `dashboard/src/pages/ProjectDetailPage.tsx` — replace inline chat with "Open chat" button
- `agent/api/chat.py` — accept attachments, lazy-bind project after tool_result
- `agent/services/llm_bridge.py` — build multimodal content blocks
- `agent/models/` — extend `ChatRequest` Pydantic model

## Tradeoffs / open questions

- **Active project mismatch:** chat đang dùng Project A, user navigate sang Project B → không tự đổi (intentional), hiển thị rõ tên project ở drawer header
- **Lazy bind edge case:** user chạy nhiều `/fk-create-project` trong 1 turn → bind cái **đầu tiên**, các cái sau bỏ qua
- **Image storage:** transient (không lưu DB) → reload chat session sẽ không thấy lại ảnh đã gửi. Acceptable cho MVP. Nếu cần persist sau → store as material qua `/api/materials`
- **Drawer vs sidebar:** chọn drawer (overlay) thay vì sidebar (push content) để main content không bị resize khi mở chat
- **Mobile:** drawer full-screen, có nút close

## Validation

- [ ] Đang stream → đổi route → quay lại chat: thấy đầy đủ partial response
- [ ] Tạo chat ở Project A → tạo Project B mới → chat A vẫn streaming OK
- [ ] "+ New (lazy)" → chat về tạo project → session auto-bind sau khi project tạo xong
- [ ] Drag/drop ảnh → preview hiển thị → gửi → Claude reply về nội dung ảnh
- [ ] Paste ảnh từ clipboard → tương tự
- [ ] Vượt limit (>4MB hoặc >4 ảnh) → show error inline, không upload
- [ ] Hotkey `Cmd+K` toggle drawer

## Order of implementation

1. **Phase 1 — Drawer + lift to App level** (foundation, không thay logic)
2. **Phase 2 — Project picker + lazy bind backend** (chính)
3. **Phase 3 — Image upload** (independent, có thể skip nếu thiếu thời gian)
4. **Phase 4 — Project Detail tab refactor** (cleanup)

Mỗi phase độc lập, có thể test riêng trước khi sang phase tiếp.
