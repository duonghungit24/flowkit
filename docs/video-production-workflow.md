# Video Production Workflow — FlowKit End-to-End Guide

Tài liệu chi tiết toàn bộ luồng sản xuất 1 video YouTube hoàn chỉnh từ ý tưởng → upload, với FlowKit. Bao gồm: luồng tự động (`/fk-pipeline`), tạo chi tiết từng giai đoạn, đóng gói thành video phát hành được.

---

## 1. Bird's-Eye View — 4 Giai Đoạn

```
┌─────────────────┐  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐
│ A. PRE-PRODUCT  │→ │ B. RENDER FARM   │→ │ C. POST-PROD     │→ │ D. PUBLISH   │
│ (manual/AI)     │  │ (auto / pipeline)│  │ (audio + assemble)│ │ (metadata)   │
├─────────────────┤  ├──────────────────┤  ├──────────────────┤  ├──────────────┤
│ research        │  │ refs             │  │ narrator text+TTS│  │ thumbnail    │
│ create-project  │  │ scene images     │  │ music (optional) │  │ youtube-seo  │
│ scene scripting │  │ videos (8s each) │  │ text overlays    │  │ youtube-     │
│ ref entities    │  │ review + retry   │  │ concat-fit-narr. │  │   upload     │
│                 │  │ upscale 4K       │  │ brand-logo       │  │              │
│                 │  │ rolling download │  │                  │  │              │
└─────────────────┘  └──────────────────┘  └──────────────────┘  └──────────────┘
   thủ công +AI       /fk-pipeline           thủ công, lệnh đơn   thủ công, lệnh đơn
```

`/fk-pipeline` chỉ phụ trách **giai đoạn B**. Trước (A) và sau (C, D) phải gọi skill riêng.

---

## 2. Giai Đoạn A — Pre-Production

### 2.1. Research (chỉ docu/news)

`/fk-research <topic> [--language vi] [--depth deep]`

- Sinh báo cáo verify sự thật vào `plans/research/`
- 5-7 câu hỏi: timeline, key figures, operations, outcomes, status, context, impact
- BẮT BUỘC chạy trước nếu video dựa trên sự kiện thật

### 2.2. Tạo project + scenes

`/fk-create-project` — interactive, hỏi user 6 thứ:

1. **name** + **story** (plot summary)
2. **material** — phong cách hình ảnh: `realistic | 3d_pixar | anime | stop_motion | minecraft | oil_painting` hoặc custom
3. **characters** — tên + ngoại hình **1 outfit duy nhất** (trang phục theo scene viết trong scene prompt, không trong character description)
4. **locations** — bối cảnh chính
5. **visual assets** — đạo cụ/object quan trọng
6. **scenes count** + **orientation** (HORIZONTAL / VERTICAL)

**Tạo project + entities (1 call):**

```bash
POST /api/projects
{
  "name": "...",
  "story": "...",
  "material": "3d_pixar",
  "characters": [
    {"name": "Luna", "entity_type": "character", "description": "..."},
    {"name": "Castle Gate", "entity_type": "location", "description": "..."},
    {"name": "Magic Wand", "entity_type": "visual_asset", "description": "..."}
  ]
}
```

**Tạo video:** `POST /api/videos { project_id, title, display_order: 0 }`

**Tạo scenes:** mỗi scene gồm:

| Field | Mô tả |
|---|---|
| `display_order` | thứ tự playback (0, 1, 2...) |
| `prompt` | English. Mô tả image (frame 0): action + environment + camera. KHÔNG mô tả ngoại hình character |
| `video_prompt` | English. Mô tả 8s video: 0-3s, 3-6s, 6-8s + Audio + SFX + Negative |
| `transition_prompt` | (chỉ chain scenes có child) Mô tả full trajectory từ start → end frame |
| `character_names` | list entities xuất hiện (chars + locations + assets) |
| `chain_type` | `ROOT` (đơn lẻ / đầu chain) hoặc `CONTINUATION` |
| `parent_scene_id` | (chỉ CONTINUATION) ID parent scene |
| `narrator_text` | (optional) text voiceover; có thể auto-gen sau bằng `/fk-gen-narrator` |

### 2.3. Chain Structure — Quyết định CONTINUATION vs ROOT

**CONTINUATION** = liền mạch hình ảnh với parent (dùng `EDIT_IMAGE`):
- Cùng character chính tiếp tục
- Cùng/sát location
- Tiếp diễn thời gian ("then he runs...")

**ROOT** = sinh fresh, không phụ thuộc:
- Đổi character/perspective
- Đổi location khác hẳn
- Interview/talking-head
- Time skip

**Parallel timelines = chain riêng.** Nếu cảnh đan xen 2 nhân vật:
```
Chain A (Defector): scene_09 [ROOT] → 10 → 12 → 14
Chain B (Pursuer):  scene_11 [ROOT] → 13 → 15
```
Interleave bằng `display_order` lúc playback.

**KHÔNG bao giờ chain 2 character khác nhau** — `EDIT_IMAGE` morph parent → child face drift.

### 2.4. Real-people Characters (rất quan trọng cho docu)

Google `UNSAFE_GENERATION` filter detect:
- Front-facing ref của famous person → reject ngay
- Title chính trị/quân sự trong prompt (đa ngôn ngữ) → high risk
- Combo iconic ("blond hair + dark suit + helicopter" = Marine One) → medium risk

**Rules:**
1. `name` = alias tiếng Anh (`The Commander`, không `Trump`)
2. `description` = chỉ ngoại hình vật lý, không tên thật
3. Famous person → ref ảnh **back view** hoặc **left-side profile**, scene prompt cũng giữ camera sau lưng
4. `narrator_text` được phép gọi tên thật (audio không feed vào generator)
5. Track mapping alias→real name trong `.omc/research/`

**Nếu fail:** escalation theo level — Camera angle → Strip names → Remove refs → Strip identity. Mỗi level retry 2-3 lần (filter random).

---

## 3. Giai Đoạn B — Render Farm (`/fk-pipeline`)

### 3.1. Lệnh full

```bash
/fk-pipeline --upscale --tts --download --notify --interval 15
```

| Flag | Hành vi |
|---|---|
| `--upscale` | Bật stage 4K upscale (TIER_TWO only) |
| `--tts` | Bật TTS narrator (song song upscale) |
| `--download` | Rolling download 4K khi upscale xong |
| `--concat` | Gọi `/fk-concat` cuối (KHÔNG dùng nếu có narrator → xài `/fk-concat-fit-narrator` riêng) |
| `--notify` | Telegram milestones |
| `--interval N` | Poll interval (default 15s) |
| `--orientation H\|V` | Override (default auto-detect) |

### 3.2. State Detection (auto-resume)

Pipeline đầu tiên đọc state để biết bắt đầu từ đâu:

```
Detected state for <project> [HORIZONTAL]:
  Refs:      5/5  ✓
  Images:    50/50 ✓
  Videos:    50/50 ✓
  Review:    passed
  Upscale:   39/50  ← in progress
  TTS:       50/50 ✓
  Downloads: 39/50  ← rolling

Plan:
  [ACTIVE] Continue upscale (11 remaining)
  [ACTIVE] Download as upscales complete
  [SKIP]   TTS (already done)
  [QUEUED] Concat
```

→ Có thể chạy lại pipeline bất cứ lúc nào, nó tự skip cái đã xong.

### 3.3. Stage Routing — 7 Stage

```
[Stage 0] REFS        — chars/locations/assets ref images
[Stage 1] IMAGES      — scene images (waves theo chain depth)
[Stage 2] VIDEOS      — scene 8s videos
[Stage 2.5] REVIEW    — Claude Vision đánh giá, fix-and-regen tối đa 2 cycles
[Stage 3] UPSCALE     — 4K (parallel với TTS)
[Stage 4] TTS         — narrator audio (parallel với UPSCALE)
[Stage 5] DOWNLOAD    — 4K mp4 files (rolling alongside UPSCALE)
[Stage 6] CONCAT      — chỉ nếu có --concat
```

**Sequential gates:** REFS → IMAGES → VIDEOS → REVIEW (mỗi cái block cái sau)
**Parallel:** UPSCALE + TTS + DOWNLOAD chạy đồng thời sau REVIEW
**Last:** CONCAT chờ tất cả xong

### 3.4. Stage Detail

#### Stage 0 — Refs (`GENERATE_CHARACTER_IMAGE`)

- Chỉ chạy nếu entity thiếu `media_id`
- Orientation auto: characters → portrait, locations → landscape
- `media_id` BẮT BUỘC là UUID (`xxxxxxxx-...`), không phải `CAMS...` (đó là `mediaGenerationId`)
- Submit batch qua `POST /api/requests/batch`
- Server tự throttle (5 concurrent + 10s cooldown)

**Fail UNSAFE_GENERATION:** escalation 3 round → left-side profile → back view → generic silhouette.

#### Stage 1 — Scene Images (waves theo chain depth)

- Pre-check: TẤT CẢ entities phải có `media_id`
- Phân scenes thành waves:

| Wave | Điều kiện | Request type |
|---|---|---|
| 1 | `chain_type==ROOT` | `GENERATE_IMAGE` |
| 2+ | `CONTINUATION` parent ở wave trước | `EDIT_IMAGE` |

- `EDIT_IMAGE` worker tự resolve: `imageInputs = [parent_image, char_A, char_B, ...]`
- CONTINUATION prompt PHẢI mô tả result (camera, angle) không mô tả parent (system tự prepend "Transform this image...")

#### Stage 2 — Videos (`GENERATE_VIDEO`)

- Pre-check: tất cả scene image phải `COMPLETED`
- Submit ALL ở 1 batch call, server throttle
- 2-5 phút/scene, poll 30s
- **Chain rule:** scene có child dùng `transition_prompt` (NOT `video_prompt`) — vì video transition từ image này → image kế

#### Stage 2.5 — Review (Claude Vision)

`POST /api/videos/<VID>/review?mode=light&orientation=...`

| Score | Action |
|---|---|
| ≥7.5 | Pass → upscale |
| 4.0-7.4 | Update `video_prompt` từ `fix_guide`+`errors` → regen video |
| <4.0 | Update prompt + regen image (cascade) → rồi regen video |

Max 2 cycles fix-and-regen. Scenes vẫn fail bị skip với cảnh báo, không block pipeline.

#### Stage 3 — Upscale (`UPSCALE_VIDEO`, TIER_TWO only)

- Submit batch sau review pass
- Resubmit failed 1 lần auto

#### Stage 4 — TTS (parallel)

- Pre-check: voice template tồn tại (`/fk-gen-tts-template` hoặc `/fk-import-voice` setup trước)
- `POST /api/videos/<VID>/narrate {template: ...}`
- Output: `output/<slug>/tts/scene_NNN_<scene_id>.wav`
- **Lưu ý:** stage này chỉ TTS từ `narrator_text` đã có. Sinh `narrator_text` cần `/fk-gen-narrator` riêng.

#### Stage 5 — Rolling Download

Mỗi poll cycle, check upscale mới xong nhưng chưa có file local:
```python
newly_completed = [s for s in scenes
  if s[f'{ori}_upscale_status']=='COMPLETED'
  and not exists(f"{OUTDIR}/4k/scene_{order:03d}_{id}.mp4")]
```

`curl URL → output/<slug>/4k/scene_NNN_<id>.mp4`

**Quan trọng:** ghi URL vào temp file trước khi `curl` — tránh shell mangle GCS signature. Verify bằng `ffprobe duration > 0`.

### 3.5. Failure Handling Matrix

| Failure | Detection | Action |
|---|---|---|
| Ref FAILED | `media_id` missing sau COMPLETED | Resubmit `GENERATE_CHARACTER_IMAGE` 1 lần |
| Image FAILED | `${ori}_image_status==FAILED` | `REGENERATE_IMAGE` 1 lần |
| Video FAILED | `${ori}_video_status==FAILED` | `GENERATE_VIDEO` 1 lần |
| Review <7.5 | review.total_score | Update prompt + regen (max 2 cycles) |
| Review <4.0 | review.total_score | Regen image first (cascade) → video |
| Upscale FAILED | `${ori}_upscale_status==FAILED` | Resubmit `UPSCALE_VIDEO` 1 lần |
| Download 4KB XML | `ffprobe duration=0` | Re-curl (URL valid ~8h) |
| Worker stalled | pending>0, processing=0 cho 2+ phút | Warn user, suggest restart |
| TTS no template | `GET /api/tts/templates` rỗng | Pause, instruct user |

**Max retries: 2 per scene per stage.** Sau đó log + skip + report cuối pipeline.

---

## 4. Giai Đoạn C — Post-Production

### 4.1. Sinh narrator text (nếu chưa có)

`/fk-gen-narrator <video_id> [--language vi] [--speed 1.1]`

**Phân loại scenes:**
- **Cinematic** → sinh narrator TTS
- **Interview** (`prompt` chứa "interview" hoặc `character_names` có "Documentary Interview Studio") → SKIP, giữ audio gốc của video

**Word count limits (HARD MAX, voice 1.2x):**

| Lang | Max words | Notes |
|---|---|---|
| VI | 22 | tonal, diacritics chậm |
| EN | 22 | baseline |
| JA | 33 | particles ngắn |
| KO | 22 | agglutinative |
| TH | 24 | tonal |
| ZH | 28 | dense |
| ES/FR | 24 | flow nhanh |
| AR | 20 | formal slow |

**Style:**
- DO: thêm context viewer KHÔNG thấy (history, stakes, motivations), tension, câu ngắn punchy, narrative arc
- DON'T: mô tả thứ visual ("we see X"), filler ("In this scene..."), passive voice

**Narrative arc (30-40 scenes):**

| Phase | Scenes | Tone |
|---|---|---|
| Setup | 1-5 | Calm, informative |
| Rising | 6-15 | Building tension |
| Climax | 16-25 | Intense, urgent |
| Resolution | 26-35 | Relief, reflection |
| Epilogue | 36-40 | Closing thoughts |

**TTS generation (per-scene reliability):**
```bash
POST /api/tts/generate
{
  "text": "<narrator_text>",
  "ref_audio": "<voice_template.wav>",
  "ref_text": "<exact transcript>",   # CRITICAL — without this voice drifts per scene
  "speed": 1.1,
  "output_path": "${OUTDIR}/tts/scene_{IDX3}_{scene_id}.wav"
}
```

**Priority voice template:** YouTube channel voice > shared template > user-specified.

### 4.2. Music (optional)

`/fk-gen-music`

- Backend: Suno API (`SUNO_API_KEY` env)
- Templates available: Cinematic, Motivational, Pop, Rock, Hip-Hop, Electronic, Country, Children, Love
- Hoặc free-form prompt

### 4.3. Text overlays (optional)

`/fk-gen-text-overlays <video_id> [--language vi]`

- Phân tích `narrator_text` mỗi scene → trích key data: dates, locations, statistics, milestones, costs
- Sinh `output/<slug>/text_overlays.json`
- Style mapping: `stat | cost | date | name`
- `/fk-concat-fit-narrator` tự burn vào nếu file tồn tại

### 4.4. Concat-fit-narrator (lõi assembly)

`/fk-concat-fit-narrator <video_id> [--buffer 0.5] [--4k]`

**Khác `/fk-concat`:** trim mỗi scene khớp duration narrator + buffer, mix SFX 30% + TTS 150%, burn text overlays.

**Steps:**

1. Detect orientation từ `meta.json`
2. Locate cho mỗi scene:
   - **Video source priority:** `4k/scene_NNN_id.mp4` > `4k/id.mp4` > `${ori}_upscale_url` > `${ori}_video_url`
   - **TTS source:** `tts/scene_NNN_id.wav`
3. Đo duration TTS → `cut_dur = tts_dur + buffer` (cap ở video duration)
4. Trim + normalize + mix 1 ffmpeg pass:
   ```
   -ss 1                                # skip first 1s static frame của video
   -t ${CUT_DUR}                        # trim đến narrator length
   filter: [0:a]vol=0.3 + [1:a]vol=1.5 amix duration=first
   scale=W:H:decrease,pad=W:H           # never downscale 4K
   -ar 48000 -ac 2                      # CRITICAL: prevents audio dropout vs intro/outro
   ```
5. Burn text overlays (nếu `text_overlays.json` tồn tại):
   - 4K: fontsize 78-84px; 1080p: 39-42px
   - x cycles `display_order % 3` → left/center/right
   - y = `h*0.25` (upper-middle)
   - fade: `enable='between(t,0.5,CUT-0.5)'`
6. **Group scenes thành segments theo chain_type:**
   - Chain segments (CONTINUATION liên tiếp) → xfade cross-dissolve 0.5s giữa scenes
   - Standalone (ROOT đơn lẻ) → hard cut
7. Final concat: `ffmpeg -f concat -c copy → ${SLUG}_narrator_cut.mp4`

**Verify:**
- `ffprobe stream=width,height` → đúng resolution không bị downscale
- `volumedetect` mean_volume between -30 và -10 dB (không -inf = câm)

### 4.5. Brand-logo (intro + outro + watermark + 4K badge)

`/fk-brand-logo <channel> <video_path> [--size 220] [--thumbnails]`

**Channel directory required (gitignored, per-machine):**
```
youtube/channels/<channel>/
  <channel>_icon.png      # required, square transparent bg
  4k_icon.png             # optional, auto-applied cho 4K
  intro_4k.mp4            # optional
  intro_4k_2x.mp4         # preferred (2x speed)
  intro_1080.mp4          # fallback
  outro_4k.mp4 / outro_1080.mp4
  channel_info.json
```

**Steps:**

1. Auto-detect resolution (4K / 1080p / 720p) → chọn logo size, intro/outro variant
2. **Normalize** intro + outro về match main video (resolution, fps, codec) — never downscale
3. **Normalize main audio** → 48kHz stereo (TTS thường 24kHz mono → audio drop khi concat với intro)
4. Concat intro + main + outro
5. Overlay brand logo bottom-right (đè watermark "V" của Veo)
6. Overlay 4K badge top-right nếu source ≥3840px
7. (Optional `--thumbnails`) apply logo lên thumbnail PNGs

**Output:** `<video_path>_branded.mp4`

---

## 5. Giai Đoạn D — Publish

### 5.1. Thumbnails

`/fk-thumbnail [project_id]`

- Sinh 4 variants
- 2-line text: Line 1 (HOOK 2-3 power words) + Line 2 (CONTEXT 5-8 words)
- Match project language

### 5.2. SEO metadata

`/fk-youtube-seo <project_id> [--language vi] [--niche military-documentary]`

- Hook title (<70 chars, click-bait nhưng không lừa)
- Description với keyword density
- Hashtags + niche keywords
- Load defaults từ `youtube/channels/<channel>/channel_rules.json` (`seo` section)

### 5.3. Upload

`/fk-youtube-upload <channel> <video_path> [--schedule "time"] [--batch] [--dry-run]`

- Auto-detect Short vs Long-form: `<61s AND vertical 9:16` → short, else long
- Load channel rules để enforce title/desc/tags policy
- `--schedule` để delayed publish
- `--batch` xử lý folder nhiều file `*_branded.mp4`
- `--dry-run` để check trước

---

## 6. Lệnh Tóm Tắt — 1 Project Hoàn Chỉnh

```bash
# === GIAI ĐOẠN A: Pre-Production ===
/fk-research "topic"                            # nếu là docu
/fk-create-project                              # interactive: name, story, scenes

# === GIAI ĐOẠN B: Render Farm (1 lệnh, 30-90 phút auto) ===
/fk-pipeline --upscale --tts --download --notify

# === GIAI ĐOẠN C: Post-Production ===
/fk-gen-narrator <video_id>                     # nếu chưa có narrator_text
/fk-gen-text-overlays <video_id>                # optional
/fk-gen-music                                   # optional
/fk-concat-fit-narrator <video_id> --4k
/fk-brand-logo <channel> output/<slug>/<slug>_narrator_cut.mp4

# === GIAI ĐOẠN D: Publish ===
/fk-thumbnail
/fk-youtube-seo <project_id>
/fk-youtube-upload <channel> output/<slug>/<slug>_narrator_cut_branded.mp4
```

**Total: ~10 lệnh** cho 1 video 5-10 phút từ ý tưởng → uploaded.

---

## 7. Pre-Flight Checklist

Trước mỗi pipeline run:

```bash
# 1. Server + extension health
curl -s http://127.0.0.1:8100/health
# expect: {"extension_connected": true}

# 2. Project tồn tại với scenes + characters
curl -s http://127.0.0.1:8100/api/projects/<PID>/characters
curl -s "http://127.0.0.1:8100/api/scenes?video_id=<VID>"

# 3. Voice template (nếu --tts)
curl -s http://127.0.0.1:8100/api/tts/templates

# 4. Channel assets (nếu publish)
ls youtube/channels/<channel>/
# required: <channel>_icon.png, channel_rules.json, channel_info.json

# 5. Env vars
echo $ANTHROPIC_API_KEY                          # cho /fk-review-video
echo $SUNO_API_KEY                               # cho /fk-gen-music
```

Lỗi gì → `/fk-doctor` chẩn đoán + fix.

---

## 8. Output Directory Layout

Sau pipeline chạy đầy đủ, structure sẽ là:

```
output/<slug>/
├── meta.json                                   # orientation, project info
├── 4k/
│   ├── scene_000_<scene_id>.mp4                # downloaded 4K
│   ├── scene_001_<scene_id>.mp4
│   └── ...
├── tts/
│   ├── scene_000_<scene_id>.wav                # TTS audio
│   ├── scene_001_<scene_id>.wav
│   └── ...
├── trimmed/                                    # narrator-fit cuts (intermediate)
│   ├── scene_000_<scene_id>.mp4
│   ├── chain_000.mp4                           # xfade chain segments
│   └── ...
├── thumbnails/
│   ├── thumbnail_v1_yt.png
│   ├── thumbnail_v1_final.png                  # branded version
│   └── ...
├── text_overlays.json                          # data points per scene
├── <slug>_narrator_cut.mp4                     # ⭐ post-concat output
└── <slug>_narrator_cut_branded.mp4             # ⭐ FINAL upload-ready
```

---

## 9. Quy Tắc Vàng Cần Nhớ

1. **`media_id` luôn là UUID** — không bao giờ là `CAMS...`. Nếu gặp `CAMS`, extract UUID từ `fifeUrl`'s `/image/{UUID}?...` segment
2. **Scene prompts = action only** — không tả ngoại hình. Visual identity carry qua `imageInputs`/`character_names`
3. **CONTINUATION prompt** mô tả result với camera explicit, không mô tả parent
4. **Chain scenes có child dùng `transition_prompt`**, không `video_prompt`
5. **Famous people: alias EN + back view + camera sau lưng**
6. **TTS: luôn pass `ref_audio` + `ref_text` cùng nhau** — thiếu `ref_text` voice drift
7. **Audio chain: 48kHz stereo end-to-end** — TTS thường xuất 24kHz mono → drop khi concat intro/outro
8. **Never downscale 4K** — pad/scale chỉ up, không down
9. **Worker tự throttle** (5 concurrent + 10s cooldown) — đừng tự loop, dùng `POST /api/requests/batch`
10. **Error routing theo substring `error_message`**, không chỉ HTTP status. Worker recognize: `not found`, `reconnected`, `captcha`, `UNSAFE_GENERATION`, `USER_QUOTA_REACHED`...

---

## 10. Skills Reference Index

| Giai đoạn | Skill | Mục đích |
|---|---|---|
| A | `/fk-research` | Fact-check sự kiện thật (docu) |
| A | `/fk-create-project` | Tạo project + entities + scenes |
| A | `/fk-add-material` | Custom visual style |
| A | `/fk-gen-tts-template` / `/fk-import-voice` | Setup voice cho TTS |
| B | `/fk-pipeline` | **Orchestrator render farm** |
| B | `/fk-gen-refs` | (manual) ref images riêng |
| B | `/fk-gen-images` | (manual) scene images riêng |
| B | `/fk-gen-videos` | (manual) videos riêng |
| B | `/fk-gen-chain-videos` | (manual) chain với end_scene_media_id |
| B | `/fk-review-video` | Quality review (auto trong pipeline) |
| B | `/fk-insert-scene` | Chèn scene mới vào project có sẵn |
| C | `/fk-gen-narrator` | Sinh narrator_text + TTS |
| C | `/fk-gen-music` | Suno BG music |
| C | `/fk-gen-text-overlays` | Data overlays |
| C | `/fk-concat-fit-narrator` | Trim + concat khớp narrator |
| C | `/fk-concat` | Concat đơn giản (không narrator) |
| C | `/fk-brand-logo` | Intro + outro + watermark |
| D | `/fk-thumbnail` | 4 thumbnails variants |
| D | `/fk-thumbnail-guide` | Hướng dẫn design thumbnail |
| D | `/fk-youtube-seo` | Title + desc + tags |
| D | `/fk-youtube-upload` | Upload + schedule |
| utils | `/fk-doctor` | Chẩn đoán mọi lỗi |
| utils | `/fk-status` / `/fk-monitor` / `/fk-dashboard` | Theo dõi tiến độ |
| utils | `/fk-fix-uuids` / `/fk-refresh-urls` | Fix media_id / signed URL hết hạn |

---

## 11. Worked Examples — End-to-End Cụ Thể

### Example 1: Documentary Quân Sự Tiếng Việt (Long-form 16:9)

**Use case:** video 5-7 phút về sự kiện quân sự thật, kênh "warzone-vn", có narrator giọng nam.

#### Bước 0: Pre-flight (1 lần đầu, không cần lặp)

```bash
# 1. Server + extension
curl -s http://127.0.0.1:8100/health
# ✓ extension_connected: true

# 2. Voice template phải có sẵn cho channel
ls youtube/channels/warzone-vn/voice_template*.wav
# Nếu chưa có → tạo:
/fk-gen-tts-template
# Hoặc import file giọng có sẵn:
/fk-import-voice ~/Downloads/narrator_male_vn.wav --channel warzone-vn

# 3. Channel branding assets
ls youtube/channels/warzone-vn/
# Required: warzone-vn_icon.png, channel_rules.json, channel_info.json
# Optional: intro_4k.mp4, outro_4k.mp4, 4k_icon.png

# 4. Env vars
export ANTHROPIC_API_KEY=sk-ant-...    # cho /fk-review-video
```

#### Bước 1: Research (5-10 phút)

```bash
/fk-research "Chiến dịch Tapalpa truy quét CJNG Mexico 2026" --language vi --depth deep
```

→ Output `plans/research/tapalpa-cjng-2026.md` với timeline, key figures (alias EN), casualty figures.

#### Bước 2: Create project (interactive, 10 phút)

```bash
/fk-create-project
```

Trả lời prompt:
- **name:** `Chien Dich Tapalpa`
- **story:** "Tháng 2/2026, đặc nhiệm Mexico mở chiến dịch Tapalpa ở Jalisco truy quét trùm CJNG El Mencho..."
- **material:** `realistic`
- **characters (alias EN):**
  - `The Cartel Boss` — "Late-50s Mexican man seen from behind, broad shoulders, black tactical vest, salt-pepper hair..." (back view vì famous)
  - `The Field Commander` — "40s Mexican Marine, tactical helmet, FX-05 rifle, body armor"
- **locations:** `Tapalpa Mountains`, `CJNG Compound`, `Mexico City War Room`
- **assets:** `Black Hawk Helicopter`, `Wanted Poster $15M`
- **scenes:** 40
- **orientation:** `HORIZONTAL`

→ Hệ thống trả về `project_id` + `video_id`.

Save 2 ID này:
```bash
PID=$(curl -s "http://127.0.0.1:8100/api/projects" | python3 -c "import sys,json;print(json.load(sys.stdin)[-1]['id'])")
VID=$(curl -s "http://127.0.0.1:8100/api/videos?project_id=$PID" | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['id'])")
echo "PID=$PID  VID=$VID"
```

#### Bước 3: Tạo scenes (manual hoặc nhờ Claude)

Có 2 cách:

**A. Nhờ Claude viết hết 40 scenes** (recommended):
```
"Dựa vào story + research, viết 40 scenes cho video này.
Scene 0-5 setup, 6-15 rising, 16-25 climax (assault), 26-35 resolution, 36-40 epilogue.
Mỗi scene gồm prompt (image, English) + video_prompt (8s, English) + chain_type + character_names.
Scene chain: assault sequence (15-25) là CONTINUATION chain, các scene khác ROOT."
```

Claude sẽ POST từng scene qua API.

**B. Manual via curl:**
```bash
curl -X POST http://127.0.0.1:8100/api/scenes \
  -H "Content-Type: application/json" \
  -d '{
    "video_id":"'$VID'",
    "display_order":0,
    "prompt":"Wide aerial shot of Tapalpa mountain forests at dawn, mist rolling over pine ridges, golden sunrise piercing through clouds. Cinematic 4K.",
    "video_prompt":"Slow aerial dolly forward over Tapalpa peaks. 0-3s: mist clearing reveals dense pine forest. 3-6s: camera tilts down to mountain village. 6-8s: morning sunlight breaks through. Audio: bird calls, wind. SFX: distant rooster. Negative: subtitles, watermark.",
    "character_names":["Tapalpa Mountains"],
    "chain_type":"ROOT"
  }'
```

#### Bước 4: Render farm — 1 lệnh (60-90 phút auto)

```bash
/fk-pipeline --upscale --tts --download --notify
```

Pipeline tự làm:
1. Refs (5 entities) → ~5 phút
2. Scene images (40 scenes, theo waves chain) → ~15 phút
3. Scene videos (40 × ~3 phút, parallel 5) → ~30 phút
4. Review (Claude Vision) + fix-and-regen → ~10 phút
5. Upscale 4K + TTS + Download (parallel) → ~20 phút

Trong lúc chờ, monitor:
```bash
/fk-status                           # snapshot
/fk-monitor --interval 30            # live tail
# hoặc browser: /fk-dashboard
```

Lỗi gì → `/fk-doctor` chẩn đoán.

#### Bước 5: Sinh narrator text (5 phút)

```bash
/fk-gen-narrator $VID --language vi --speed 1.1
```

Claude tự đọc 40 `video_prompt`s → sinh narrator_text VN ≤22 words/scene → save vào DB → generate TTS WAV.

Pipeline hỏi confirm trước khi TTS, có thể edit từng scene:
```
Review OK? Type 'yes' to generate TTS, or 'edit N' to modify scene N's text.
> edit 16
[Claude shows scene 16 narrator, asks for new version]
> yes
```

#### Bước 6: Sinh text overlays (2 phút)

```bash
/fk-gen-text-overlays $VID --language vi
```

Claude phân tích narrator → trích date/name/stat/cost vào `output/<slug>/text_overlays.json`.

Review:
```bash
cat output/chien-dich-tapalpa/text_overlays.json | python3 -m json.tool | head -30
```

Edit thủ công nếu muốn.

#### Bước 7: (Optional) Music

```bash
/fk-gen-music
# Chọn template "cinematic_epic" hoặc "military_tension"
# Output: output/<slug>/music/bg_track.mp3
```

#### Bước 8: Concat + brand (5-10 phút ffmpeg)

```bash
SLUG="chien-dich-tapalpa"
OUTDIR="output/$SLUG"

# Trim + mix narrator + burn overlays + concat
/fk-concat-fit-narrator $VID --4k

# → ${OUTDIR}/${SLUG}_narrator_cut.mp4 (chưa có intro/outro)

# Branding
/fk-brand-logo warzone-vn ${OUTDIR}/${SLUG}_narrator_cut.mp4

# → ${OUTDIR}/${SLUG}_narrator_cut_branded.mp4 ⭐ FINAL
```

Verify:
```bash
ffprobe -v quiet -show_entries format=duration,stream=width,height -of default ${OUTDIR}/${SLUG}_narrator_cut_branded.mp4
ls -lh ${OUTDIR}/${SLUG}_narrator_cut_branded.mp4
```

#### Bước 9: Thumbnails + SEO

```bash
/fk-thumbnail $PID
# → output/<slug>/thumbnails/thumbnail_v{1,2,3,4}_yt.png

# Apply brand logo lên thumbnails
/fk-brand-logo warzone-vn ${OUTDIR}/${SLUG}_narrator_cut_branded.mp4 --thumbnails
# → thumbnail_v{1,2,3,4}_final.png

# SEO metadata
/fk-youtube-seo $PID --language vi --niche military-documentary
# → output/<slug>/youtube_meta.json
```

Review:
```bash
cat output/$SLUG/youtube_meta.json | python3 -m json.tool
```

#### Bước 10: Upload

```bash
# Dry-run trước
/fk-youtube-upload warzone-vn ${OUTDIR}/${SLUG}_narrator_cut_branded.mp4 --dry-run

# Schedule lên 8h sáng mai
/fk-youtube-upload warzone-vn ${OUTDIR}/${SLUG}_narrator_cut_branded.mp4 --schedule "tomorrow 08:00"
```

→ Done. Total time: ~2-3 giờ wall-clock, ~30 phút tay người.

---

### Example 2: YouTube Short Vertical (60s, không narrator)

**Use case:** Short fiction 9:16, có nhạc + text overlays, không voiceover.

```bash
# 1. Create project (8 scenes × 8s = 64s, trim còn ≤60s)
/fk-create-project
# orientation: VERTICAL, scenes: 8, material: anime

# 2. Render farm — không cần TTS
/fk-pipeline --upscale --download --notify
# Chờ ~25 phút

# 3. Music (BẮT BUỘC vì không có narrator)
/fk-gen-music
# → output/<slug>/music/bg_track.mp3

# 4. Sinh text overlays thủ công (không có narrator để analyze)
nano output/<slug>/text_overlays.json
# {
#   "0": [{"text":"DAY 1", "style":"date"}],
#   "3": [{"text":"THE TURNING POINT", "style":"name"}],
#   "7": [{"text":"WILL HE SURVIVE?", "style":"stat"}]
# }

# 5. Concat (dùng /fk-concat thường, KHÔNG fit-narrator)
/fk-concat $VID --4k --with-music
# → output/<slug>/<slug>_final.mp4

# 6. Brand (skip intro vì Short ngắn)
/fk-brand-logo myshorts-channel output/<slug>/<slug>_final.mp4 --no-intro --no-outro

# 7. Upload — auto-detect Short vì <61s + 9:16
/fk-youtube-upload myshorts-channel output/<slug>/<slug>_final_branded.mp4
```

---

### Example 3: Resume Project Dở Dang

Pipeline crash giữa chừng (mất extension, hết quota), restart:

```bash
# 1. Check tình trạng
/fk-status
# → Refs: 5/5 ✓, Images: 40/40 ✓, Videos: 32/40 (8 PENDING), TTS: 0/40

# 2. Doctor check
/fk-doctor
# → "8 videos PENDING, extension reconnected, ready to resume"

# 3. Resume — pipeline tự skip cái xong
/fk-pipeline --upscale --tts --download --notify
# Detected state shows 32/40, plan: continue videos → upscale → TTS → download
```

→ Không cần xóa data, không cần restart từ đầu.

---

### Example 4: Fix Failed Scenes Riêng Lẻ

Sau pipeline xong, có 2 scenes review điểm <7.5 chưa fix được:

```bash
# 1. List failed
curl -s "http://127.0.0.1:8100/api/scenes?video_id=$VID" | \
  python3 -c "import sys,json; [print(s['display_order'], s['id'], s.get('horizontal_video_status')) for s in json.load(sys.stdin) if 'FAIL' in str(s.get('horizontal_video_status',''))]"

# 2. Update prompt cho scene 23
curl -X PATCH "http://127.0.0.1:8100/api/scenes/<SID>" \
  -H "Content-Type: application/json" \
  -d '{"video_prompt": "Static camera fixed on tripod, no drift. <new prompt>..."}'

# 3. Regen video (cascade clears upscale tự động)
curl -X POST http://127.0.0.1:8100/api/requests \
  -H "Content-Type: application/json" \
  -d '{"type":"GENERATE_VIDEO","scene_id":"<SID>","project_id":"'$PID'","video_id":"'$VID'","orientation":"HORIZONTAL"}'

# 4. Resume pipeline để upscale + download lại scene đó
/fk-pipeline --upscale --download
```

---

### Example 5: Chỉ Đổi Music + Re-Concat (không re-render)

Đã có video, muốn đổi nhạc nền khác:

```bash
# 1. Sinh nhạc mới
/fk-gen-music
# Pick template khác

# 2. Re-concat (dùng cached scene videos + new music)
/fk-concat-fit-narrator $VID --4k
# → output/<slug>/<slug>_narrator_cut.mp4 (mới)

# 3. Re-brand
/fk-brand-logo warzone-vn output/<slug>/<slug>_narrator_cut.mp4
```

→ Không tốn credit Flow, chỉ ffmpeg local.

---

## 12. Cheat Sheet — Lệnh Theo Tình Huống

| Tình huống | Lệnh |
|---|---|
| **Full auto (3 lệnh)** | `/fk-script "<topic>" --scenes 40` → `/fk-pipeline --upscale --tts --download --notify` → `/fk-finalize $VID <channel> --schedule "tomorrow 08:00"` |
| Bắt đầu từ 0 (docu) | `/fk-research` → `/fk-create-project` (hoặc `/fk-script`) → `/fk-pipeline --upscale --tts --download --notify` |
| Bắt đầu từ 0 (fiction) | `/fk-create-project` → `/fk-pipeline --upscale --tts --download --notify` |
| Post-prod + publish (1 lệnh) | `/fk-finalize $VID <channel>` |
| Resume sau crash | `/fk-status` → `/fk-doctor` → `/fk-pipeline` (cùng flags) |
| Chỉ refs | `/fk-gen-refs $PID` |
| Chỉ images | `/fk-gen-images $PID $VID` |
| Chỉ videos | `/fk-gen-videos $PID $VID` |
| Regen 1 scene | `PATCH /api/scenes/<SID>` rồi `POST /api/requests {type:REGENERATE_IMAGE,...}` |
| Add scene mới giữa chừng | `/fk-insert-scene` |
| Quality check | `/fk-review-video $VID --mode deep` |
| Sinh narrator | `/fk-gen-narrator $VID` |
| Sinh overlays | `/fk-gen-text-overlays $VID` |
| Final assembly (có narrator) | `/fk-concat-fit-narrator $VID --4k` |
| Final assembly (không narrator) | `/fk-concat $VID --4k --with-music` |
| Branding | `/fk-brand-logo <channel> <video.mp4>` |
| Thumbnails + SEO | `/fk-thumbnail $PID` + `/fk-youtube-seo $PID` |
| Upload single | `/fk-youtube-upload <channel> <video.mp4>` |
| Upload batch (Shorts) | `/fk-youtube-upload <channel> output/<slug>/subclips/ --batch` |
| Schedule upload | `/fk-youtube-upload <channel> <video> --schedule "tomorrow 08:00"` |
| URL hết hạn (>8h) | `/fk-refresh-urls $PID` |
| Fix CAMS media_id | `/fk-fix-uuids $PID` |
| Lỗi bất kỳ | `/fk-doctor` |

---

## 13. Auto-From-Topic Workflow — Gần Như Tự Động Từ Ý Tưởng

Với 2 skill mới `/fk-script` + `/fk-finalize`, full pipeline từ topic → uploaded video chỉ còn **3 lệnh** (~10 phút thao tác user, ~90 phút render).

### Bản Đồ Tự Động Hoá

| Bước | Mức tự động | Skill |
|---|---|---|
| Topic → Story → Entities → Scenes | ✅ AUTO + 1 review gate | `/fk-script` |
| Refs → Images → Videos → Review → Upscale → TTS | ✅ FULL AUTO | `/fk-pipeline` |
| Narrator + Overlays + Music + Concat + Brand + Thumbnail + SEO + Upload | ✅ FULL AUTO + 1 confirm | `/fk-finalize` |

### Workflow Full Auto — 3 Lệnh

```bash
# 1. Topic → Project + Scenes (auto research + scripting, ~5 phút thao tác)
/fk-script "Operation Tapalpa CJNG 2026" \
  --scenes 40 \
  --orientation H \
  --language vi \
  --material realistic \
  --channel warzone-vn

# Skill sẽ:
# - Chạy /fk-research nội bộ (hoặc reuse với --skip-research)
# - Auto-detect real-people content → alias EN + back-view rules
# - Design 7-10 sentence story + 3-7 entities + N scenes với chain structure
# - In review table → user gõ "yes" / "edit N" / "cancel"
# - POST tạo project + video + scenes (2-pass cho parent_scene_id)

# 2. Render farm (auto, ~60-90 phút, không cần thao tác)
/fk-pipeline --upscale --tts --download --notify

# 3. Post-prod + Publish (auto, ~10-15 phút, 1 confirm gate)
/fk-finalize $VID warzone-vn --schedule "tomorrow 08:00" --with-music

# Skill sẽ:
# - State detection: skip stage đã COMPLETED (idempotent — re-run sau crash OK)
# - Chain: narrator → overlays → music → concat-fit-narrator → brand-logo → thumbnails → SEO → upload
# - In summary trước khi upload → user confirm
# - Schedule YouTube upload theo --schedule flag
```

### Tại Sao Còn 2 Review Gate

Cố ý — **không auto-gen mù**:

- **Gate 1 (`/fk-script` review)**: 40 scenes prompt sai = 40 × $X video credit lãng phí. Real-people sai alias → `UNSAFE_GENERATION`. Stop-and-review rẻ hơn discover-broken-after-render.
- **Gate 2 (`/fk-finalize` upload confirm)**: YouTube upload không thể undo (chỉ delete được). Verify thumbnail + SEO + brand-logo render đúng trước khi public.

Bỏ qua gate bằng `--yes` flag chỉ khi đã chạy template tin tưởng (cùng channel, cùng style, ≥10 lần).

### Khi Nào Dùng Skill Cũ Thay Thế

| Tình huống | Skill cũ thay vì /fk-script + /fk-finalize |
|---|---|
| <10 scenes, fiction, custom visual | `/fk-create-project` interactive |
| Chỉ cần render farm, không publish | `/fk-pipeline` (skip `/fk-finalize`) |
| Chỉ cần concat + brand, không upload | `/fk-concat-fit-narrator` + `/fk-brand-logo` |
| Re-render 1 scene sau crash | `PATCH /api/scenes/<SID>` + `POST /api/requests` |

---

## Unresolved Questions

- **Music mix in finalize:** `/fk-finalize --with-music` mix BG music sau concat-fit-narrator (volume 0.15, ducking optional). Đã giải quyết bằng inline ffmpeg trong skill — chưa tách thành skill riêng `/fk-mix-music` nếu cần custom curve
- **Multi-video projects:** workflow hiện tại tối ưu cho 1 project = 1 video. Nếu project có nhiều videos (series), `/fk-pipeline` chỉ xử lý 1 video tại 1 thời điểm — chưa có "loop projects" mode
- **Cost tracking:** chưa có dashboard tổng số credits Flow + Suno + Anthropic Vision tiêu trên 1 project
- **`/fk-script` review UX:** hiện gõ `edit N` text-based; nếu nhiều scenes cần edit, chậm. TODO: support `edit N-M` range hoặc batch edit qua file
- **`/fk-finalize` resume granularity:** state detection hiện ở stage level (skip nếu file output tồn tại). Chưa detect partial render (vd: thumbnail 3/5 đã gen). Re-run sẽ regenerate full thumbnail set
