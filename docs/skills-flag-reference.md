# Skills Flag Reference — Flow Kit

Reference đầy đủ về flag/suffix của mọi `/fk-*` skill, phân theo phase pipeline. Mỗi flag có: ý nghĩa, default, khi nào nên dùng, ví dụ thực tế.

**Quy tắc chung:**
- Flag không có giá trị = bool switch (`--with-music`, `--dry-run`, `--force`).
- Flag có giá trị = `--key value` (không có `=`): `--language vi`, `--scenes 40`, `--schedule "tomorrow 08:00"` (string có space phải có `""`).
- Flag dạng `--no-X` = tắt stage mặc định ON (chỉ ở `/fk-finalize`, `/fk-brand-logo`).
- Order flag không quan trọng; positional args (`<video_id>`, `<channel>`) phải đúng vị trí trước flag.

---

## PHASE 1 — Research & Scripting

### `/fk-research <topic> [flags]`
Fact-check + thu thập dữ kiện trước khi viết kịch bản. Output: `plans/research/<slug>.md`.

| Flag | Default | Ý nghĩa | Khi nào dùng |
|---|---|---|---|
| `--language <code>` | `vi` | Ngôn ngữ output report | Đổi nếu cần research bằng tiếng khác (`en`, `es`...) |
| `--depth quick\|deep` | `deep` | `quick` = 3-5 search; `deep` = 10+ search có cross-reference | Topic đã quen → `quick` tiết kiệm thời gian |

```bash
/fk-research "Operation Tapalpa CJNG 2026" --language vi --depth deep
/fk-research "Đảo Phú Quốc lịch sử" --depth quick
```

---

### `/fk-script <topic> [flags]` HOẶC `/fk-script --from-script <file> [flags]`

**2 modes:**
- **Topic mode** (default): chỉ truyền topic, skill tự gọi `/fk-research` → AI design story/entities/scenes → POST API.
- **From-script mode** (`--from-script <file>`): truyền file JSON đã viết sẵn, skip research + AI design → validate → POST API.

Khi bật `--auto`, cả 2 mode đều tự chain tiếp `/fk-pipeline` + `/fk-finalize` → end-to-end 1 lệnh.

| Flag | Default | Ý nghĩa | Khi nào dùng |
|---|---|---|---|
| `--from-script <file>` | — | Load script JSON viết sẵn, skip research + AI design | Đã có kịch bản đầy đủ (scenes + characters) muốn 1 lệnh render |
| `--scenes N` | `40` | Tổng số scene. Bỏ qua trong from-script mode | Short YT: `--scenes 8`; documentary dài: `--scenes 60` |
| `--orientation H\|V` | `H` | HORIZONTAL hoặc VERTICAL. Bỏ qua trong from-script mode | YT Shorts/TikTok: `V` |
| `--language <code>` | `vi` | Ngôn ngữ narrator + overlays. Bỏ qua trong from-script mode | Channel tiếng Anh: `--language en` |
| `--material <style>` | `realistic` | `realistic \| 3d_pixar \| anime \| stop_motion \| minecraft \| oil_painting`. Bỏ qua trong from-script mode | Channel trẻ em: `3d_pixar`; war/crime: `realistic` |
| `--channel <name>` | — | Load `youtube/channels/<name>/channel_rules.json`. **Bắt buộc khi `--auto`** | Project gắn channel cụ thể |
| `--skip-research` | off | Reuse `plans/research/<slug>.md` (topic mode only) | Đã chạy `/fk-research` riêng trước đó |
| `--auto` | off | Sau commit, tự chain `/fk-pipeline` → `/fk-finalize`. Implies `--yes`. Cần `--channel` | Muốn 1 lệnh chạy hết → YouTube upload |
| `--yes` | off | Skip Step 8 review gate (auto-confirm script) | CI/batch, template tin tưởng |
| `--no-upload` | off | Stop sau concat. Chỉ có tác dụng khi đi với `--auto` | Muốn review video cuối trước upload tay |
| `--schedule "<when>"` | — | Truyền sang `/fk-finalize` (e.g. `"tomorrow 08:00"`) | Lên lịch publish YouTube |

**Topic mode examples:**
```bash
# Manual (mặc định, có review gate)
/fk-script "Operation Tapalpa CJNG 2026" --scenes 40 --orientation H --language vi --channel warzone-vn

# Short vertical, no review
/fk-script "Cá heo thông minh" --scenes 12 --orientation V --material 3d_pixar --yes

# Full end-to-end: topic → YouTube scheduled (1 lệnh)
/fk-script "Operation Tapalpa CJNG 2026" --scenes 40 --channel warzone-vn --auto --schedule "tomorrow 08:00"
```

**From-script mode examples:**
```bash
# Commit script viết sẵn, dừng sau Step 9 (review video script trước khi render)
/fk-script --from-script plans/my-episode-01.json

# 1 lệnh từ kịch bản → YouTube upload
/fk-script --from-script plans/my-episode-01.json --channel warzone-vn --auto --schedule "tomorrow 08:00"

# Dùng template cho nhiều episode (chỉ đổi file)
/fk-script --from-script plans/series-warzone/ep-02.json --channel warzone-vn --auto
```

**Format `--from-script` JSON** (chi tiết trong `skills/fk-script.md` "From-Script Mode" section):
```json
{
  "name": "Episode 01",
  "story": "...",
  "material": "realistic",
  "language": "vi",
  "orientation": "HORIZONTAL",
  "characters": [{"name": "Hero", "entity_type": "character", "description": "..."}],
  "scenes": [
    {"display_order": 0, "prompt": "...", "video_prompt": "...", "character_names": ["Hero"], "chain_type": "ROOT"},
    {"display_order": 1, "prompt": "...", "video_prompt": "...", "character_names": ["Hero"], "chain_type": "CONTINUATION", "parent_display_order": 0, "transition_prompt": "..."}
  ]
}
```

**Failure handling khi `--auto`:** Nếu `/fk-pipeline` hoặc `/fk-finalize` fail giữa chừng, skill abort và in resume command (`/fk-pipeline <PID> ...` hoặc `/fk-finalize <VID> <channel>`). Không silent retry — chạy `/fk-doctor` trước rồi resume tay.

**Failure handling cho `--from-script`:** Validate file trước khi POST. Lỗi schema → in tất cả errors 1 lần (không fix-one-and-retry). File JSON sai → in line/column. File không tồn tại → abort với path mong đợi.

---

### `/fk-create-project` (interactive Q&A)
Không có flag — chạy không tham số, system hỏi từng bước. Dùng khi ít scene (<10) hoặc cần custom thủ công.

```bash
/fk-create-project
```

---

## PHASE 2 — Render Pipeline

### `/fk-pipeline [project_id] [orientation] [flags]`
Smart orchestrator — chạy refs → images → videos → upscale → tts theo thứ tự, dispatch song song khi có thể.

| Flag | Default | Ý nghĩa | Khi nào dùng |
|---|---|---|---|
| `--upscale` | off | Bật stage 4K upscale (chỉ tier 2) | Long-form YT cần 4K |
| `--tts` | off | Bật TTS narration (parallel với upscale) | Cinematic có narrator |
| `--download` | off | Auto-download 4K xuống `output/<slug>/4k/` khi xong | Luôn bật nếu có `--upscale` |
| `--concat` | off | Auto-run concat sau khi mọi stage xong | Muốn ra file MP4 ngay (không cần overlay/brand) |
| `--notify` | off | Gửi Telegram noti tại milestone | Pipeline dài, để chạy nền |
| `--interval N` | `15` | Giây giữa các lần poll status | Server bận: tăng `--interval 30` |
| `--orientation H\|V` | auto | Override orientation từ video | Hiếm khi cần |

```bash
# Combo chuẩn cho long-form
/fk-pipeline --upscale --tts --download --notify

# Quick render không 4K
/fk-pipeline --tts --concat
```

---

### `/fk-monitor [project_id] [orientation] [flags]`
Theo dõi pipeline real-time (chỉ đọc, không trigger).

| Flag | Default | Ý nghĩa |
|---|---|---|
| `--download` | off | Auto-download upscale mới về `output/<slug>/4k/` |
| `--interval N` | `30` | Giây giữa các lần poll |

```bash
/fk-monitor --download --interval 20
```

---

### Skill render đơn lẻ (gọi tay khi cần regen)

| Skill | Cú pháp | Mục đích |
|---|---|---|
| `/fk-gen-refs <project_id>` | — | Generate reference image cho mọi entity |
| `/fk-gen-images <project_id> <video_id>` | — | Generate scene image (frame 0) |
| `/fk-gen-videos <project_id> <video_id>` | — | Image-to-video cho mỗi scene |
| `/fk-gen-chain-videos <project_id> <video_id>` | — | Chỉ render chain CONTINUATION scene |
| `/fk-upload-image <file> [--project <PID>] [--entity <EID>]` | `--project`: gán vào project; `--entity`: gán làm ref cho entity | Upload ảnh local làm material/ref |
| `/fk-refresh-urls <video_id> [--project-id <PID>]` | `--project-id`: nếu nhiều video cùng PID | Refresh signed URL hết hạn (1h TTL) |
| `/fk-fix-uuids <PID> <VID>` | — | Sửa `media_id` còn ở dạng `CAMS...` thành UUID |
| `/fk-insert-scene <VID> <after_order> "<prompt>"` | — | Chèn scene mới sau scene số `after_order` |

---

## PHASE 3 — Voice + Music

### `/fk-gen-narrator <video_id> [flags]`
Generate narrator text → TTS WAV cho mọi scene.

| Flag | Default | Ý nghĩa | Khi nào dùng |
|---|---|---|---|
| `--force` | off | Re-gen kể cả khi `narrator_text` đã có | Sửa story muốn viết lại |
| `--language <code>` | from project | Ngôn ngữ narrator | Override khi project setup sai |
| `--speed N` | `1.1` | Tốc độ đọc (1.0 = bình thường) | `0.95` cho slow/dramatic, `1.2` cho fast news |

```bash
/fk-gen-narrator $VID --language vi --speed 1.1
/fk-gen-narrator $VID --force --speed 0.95   # tone trầm
```

---

### `/fk-gen-text-overlays <video_id> [flags]`
Sinh JSON overlay text từ narrator (key facts, numbers, dates).

| Flag | Default | Ý nghĩa |
|---|---|---|
| `--language <code>` | auto-detect | **Bắt buộc** dùng đúng ngôn ngữ + dấu (Việt → có dấu) |

```bash
/fk-gen-text-overlays $VID --language vi
```

---

### `/fk-gen-tts-template` / `/fk-import-voice`
Không flag (interactive). Setup voice template trước khi `/fk-gen-narrator`.

```bash
/fk-gen-tts-template                                          # record/generate mới
/fk-import-voice path/to/sample.wav --channel warzone-vn      # import có sẵn
```

---

### `/fk-gen-music`
Không flag — interactive (chọn template: `cinematic_epic`, `military_tension`, etc.). Cần `SUNO_API_KEY`.

---

## PHASE 4 — Post-Production

### `/fk-concat <video_id> [flags]`
Concat scene videos thành 1 MP4 (không xử lý narrator timing).

| Flag | Default | Ý nghĩa |
|---|---|---|
| `--with-tts` | off | Mix TTS audio nếu có |
| `--4k` | off | Concat từ source 4K (không 1080p) |

---

### `/fk-concat-fit-narrator <video_id> [flags]`
**Khác `/fk-concat`:** trim mỗi scene theo độ dài TTS + xfade chain + burn overlay. Đây là stage 4 của `/fk-finalize`.

| Flag | Default | Ý nghĩa | Khi nào dùng |
|---|---|---|---|
| `--buffer N` | `0.5` | Giây đệm sau TTS mỗi scene | Audio bị cụt → tăng `--buffer 1.0` |
| `--4k` | off | Dùng source 4K | Final cut chuẩn YT |

```bash
/fk-concat-fit-narrator $VID --4k --buffer 0.8
```

---

### `/fk-brand-logo <channel> <video_path> [flags]`
Apply intro + outro + watermark + 4K badge.

| Flag | Default | Ý nghĩa |
|---|---|---|
| `--size N` | auto | Override kích thước logo (px) |
| `--thumbnails` | off | Apply logo vào file thumbnail PNG luôn |
| `--no-intro` | off | Bỏ intro |
| `--no-outro` | off | Bỏ outro |

```bash
/fk-brand-logo warzone-vn output/abc/abc_narrator_cut.mp4
/fk-brand-logo warzone-vn output/abc/abc_narrator_cut_branded.mp4 --thumbnails
```

---

### `/fk-thumbnail [project_id]`
Sinh 4 variant thumbnail. Không flag — auto pick main character.

```bash
/fk-thumbnail $PID
```

---

### `/fk-review-video <video_id> [flags]`
Claude Vision review chất lượng video (cần `ANTHROPIC_API_KEY`).

| Flag | Default | Ý nghĩa |
|---|---|---|
| `--mode light\|deep` | `light` | `light` = sample frame; `deep` = full scan từng scene |

```bash
/fk-review-video $VID --mode deep
```

---

### `/fk-review-board [video_id]`
Bật web board duyệt scene-by-scene. Không flag.

---

## PHASE 5 — Publish

### `/fk-youtube-seo <project_id> [flags]`
Sinh title, description, tags, hashtag.

| Flag | Default | Ý nghĩa |
|---|---|---|
| `--language <code>` | from project | Ngôn ngữ output |
| `--niche <name>` | auto | E.g. `military-documentary`, `kids-3d` → áp template SEO theo niche |

```bash
/fk-youtube-seo $PID --language vi --niche military-documentary
```

---

### `/fk-youtube-upload <channel> <video_path_or_dir> [flags]`
Upload (auto-detect Short vs Long-form).

| Flag | Default | Ý nghĩa |
|---|---|---|
| `--schedule "time"` | immediate | Lịch publish (e.g. `"tomorrow 08:00"`, `"2026-05-12 14:00"`) |
| `--batch` | off | `<video_path_or_dir>` là folder → upload nhiều file |
| `--dry-run` | off | Mọi prep nhưng skip upload |

```bash
/fk-youtube-upload warzone-vn output/abc/abc_final.mp4 --schedule "tomorrow 08:00"
/fk-youtube-upload warzone-vn output/batch_folder --batch
```

---

### `/fk-finalize <video_id> <channel> [flags]` — gộp Stage 1→8

| Flag | Default | Ý nghĩa | Khi nào dùng |
|---|---|---|---|
| `--schedule "time"` | immediate | Lịch publish | Channel có lịch đăng |
| `--with-music` | off | Bật stage 3 (Suno BG music) | Cinematic cần nhạc nền |
| `--no-overlays` | off | Skip burn overlay | Test nhanh / không cần overlay |
| `--no-thumbnails` | off | Skip sinh thumbnail | Đã có thumbnail thủ công |
| `--dry-run` | off | Chạy hết stage 1-7, skip stage 8 (upload) | Kiểm tra output trước khi publish |
| `--language <code>` | from project | Override ngôn ngữ narrator+SEO | Hiếm khi cần |

```bash
/fk-finalize $VID warzone-vn --schedule "tomorrow 08:00"
/fk-finalize $VID warzone-vn --with-music --dry-run    # test có nhạc
```

---

## PHASE 6 — Utilities

| Skill | Cú pháp | Mục đích |
|---|---|---|
| `/fk-status [project_id]` | không flag | List projects hoặc xem detail 1 project |
| `/fk-doctor` | không flag | Diagnose pipeline error (chạy khi có FAILED / stuck) |
| `/fk-dashboard` | không flag | Mở web dashboard `dashboard/` |
| `/fk-switch-project [PID\|clear]` | `clear` để reset | Đổi active project |
| `/fk-change-model [list\|<key>]` | `list` để xem | Đổi model video/image (xem `models.json`) |
| `/fk-add-material` | (xem skill) | Thêm image material |
| `/fk-creative-mix <PID> <VID>` | không flag | Thử technique sáng tạo (T1 chaining, etc.) |

---

## Cheatsheet — Pattern thường dùng

```bash
# A1) Full-auto từ topic → publish (1 lệnh, --auto chain tất cả)
/fk-script "<topic>" --language vi --scenes 40 --channel warzone-vn --auto --schedule "tomorrow 08:00"

# A2) Full-auto 3 lệnh (manual, có review gate ở fk-script)
/fk-script "<topic>" --language vi --scenes 40 --orientation H --channel warzone-vn
/fk-pipeline --upscale --tts --download --notify
/fk-finalize $VID warzone-vn --schedule "tomorrow 08:00"

# B) Quick test (không 4K, không upload)
/fk-script "<topic>" --scenes 8 --skip-research
/fk-pipeline --tts --concat
/fk-finalize $VID warzone-vn --dry-run --no-thumbnails

# C) Re-render 1 scene
/fk-insert-scene $VID 12 "<new prompt>"
/fk-gen-images $PID $VID                     # auto skip scene đã COMPLETED
/fk-gen-videos $PID $VID

# D) Resume sau khi pipeline crash
/fk-monitor --download                       # xem state
/fk-doctor                                   # nếu có FAILED
/fk-pipeline --upscale --tts --download      # tự skip phần đã xong

# E) Đổi tone narrator + re-publish
/fk-gen-narrator $VID --force --speed 0.95
/fk-finalize $VID warzone-vn                 # detect narrator_cut cũ → re-build
```

---

## Pipeline overview

```
PHASE 1 (Scripting)
  /fk-research → /fk-script  (or /fk-create-project)
         ↓
PHASE 2 (Rendering)
  /fk-pipeline → refs → images → videos → upscale → tts
         ↓
PHASE 3 (Voice + Music)
  /fk-gen-narrator → /fk-gen-text-overlays → /fk-gen-music (opt)
         ↓
PHASE 4 (Post-Production)
  /fk-concat-fit-narrator → /fk-brand-logo → /fk-thumbnail
         ↓
PHASE 5 (Publish)
  /fk-youtube-seo → /fk-youtube-upload
         ↓
       ALL 3-5 wrapped by  /fk-finalize  (idempotent resume)
```

---

## Unresolved questions

- `/fk-create-project` có thể nhận flag command-line không, hay luôn interactive? (hiện skill file không document flag)
- `/fk-add-material` chưa có example flag — cần verify trực tiếp trong skill file
- `/fk-creative-mix` có technique nào ngoài T1 chaining không?
