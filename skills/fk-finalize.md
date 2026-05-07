# fk-finalize — Post-Production + Publish in One Command

Chain post-production + publish: narrator → overlays → (music) → concat-fit → brand → thumbnail → SEO → upload. Auto-skips stages already done.

Usage: `/fk-finalize <video_id> <channel> [--schedule "time"] [--with-music] [--no-overlays] [--no-thumbnails] [--dry-run] [--language vi]`

- `video_id` — target video (UUID)
- `channel` — channel name under `youtube/channels/<channel>/`
- `--schedule "time"` — delayed publish (e.g. `"tomorrow 08:00"`); omit for immediate
- `--with-music` — generate + mix BG music via Suno (default: skip)
- `--no-overlays` — skip text overlays burn-in
- `--no-thumbnails` — skip thumbnail generation
- `--dry-run` — run all stages but skip final upload
- `--language` — narrator/SEO language (default: from project)

---

## When to Use

- Pipeline rendered done (refs/images/videos/upscale/TTS COMPLETED)
- Want to ship in 1 lệnh thay vì 6 lệnh chuỗi
- Final review pass: scenes look good, ready to publish

**DO NOT use when:** any scene still PENDING/PROCESSING/FAILED, voice template missing, channel assets not setup.

---

## Step 1: Pre-flight checks

### 1a. Server + extension

```bash
curl -s http://127.0.0.1:8100/health
# Required: extension_connected: true
```

### 1b. Video state

```bash
curl -s "http://127.0.0.1:8100/api/videos/<VID>"
curl -s "http://127.0.0.1:8100/api/scenes?video_id=<VID>" > /tmp/fk_scenes.json
```

Detect orientation:
```bash
ORI=$(python3 -c "import json; v=json.load(open('/tmp/fk_video.json')); print(v.get('orientation','HORIZONTAL'))")
ori=$(echo "$ORI" | tr '[:upper:]' '[:lower:]')
```

**ABORT** if any scene has:
- `${ori}_video_status` != `COMPLETED`
- (`--with-music` skipped) Otherwise OK to proceed without 4K — branding/concat handles 1080p too

If any scene is FAILED → abort, instruct user to fix via regen or `/fk-doctor`.

### 1c. Channel assets

```bash
CHANNEL_DIR="youtube/channels/<channel>"
test -f "${CHANNEL_DIR}/<channel>_icon.png" || ABORT
test -f "${CHANNEL_DIR}/channel_rules.json" || ABORT
test -f "${CHANNEL_DIR}/channel_info.json" || ABORT
```

Print:
```
Channel: <channel>
  Icon:        ✓
  Intro:       <intro_4k_2x.mp4 | intro_4k.mp4 | intro_1080.mp4 | none>
  Outro:       <outro_4k.mp4 | outro_1080.mp4 | none>
  4K badge:    <✓ | none>
  Voice:       <voice_template_male.wav | voice_template_female.wav | none>
```

### 1d. Voice template (for narrator)

If any scene needs narrator (cinematic, not interview) → require voice template:
```bash
ls youtube/channels/<channel>/voice_template*.wav 2>/dev/null
# Or fallback:
curl -s http://127.0.0.1:8100/api/tts/templates
```

If neither → ABORT, instruct: `/fk-gen-tts-template` or `/fk-import-voice <wav> --channel <channel>`.

### 1e. Env vars

```bash
test -n "$ANTHROPIC_API_KEY" || warn "no review possible without ANTHROPIC_API_KEY"
[ "$WITH_MUSIC" ] && test -n "$SUNO_API_KEY" || ABORT "set SUNO_API_KEY for --with-music"
```

---

## Step 2: State detection (skip stages already done)

```python
PROJ_OUT = curl /api/projects/<PID>/output-dir
SLUG, OUTDIR = PROJ_OUT['slug'], PROJ_OUT['path']

state = {
    'narrator_text': all(s.get('narrator_text') for s in cinematic_scenes),
    'tts_files': len(glob(f"{OUTDIR}/tts/scene_*.wav")) >= len(cinematic_scenes),
    'overlays_json': os.path.exists(f"{OUTDIR}/text_overlays.json"),
    'music_track': os.path.exists(f"{OUTDIR}/music/bg_track.mp3"),
    'narrator_cut': os.path.exists(f"{OUTDIR}/{SLUG}_narrator_cut.mp4"),
    'branded': os.path.exists(f"{OUTDIR}/{SLUG}_narrator_cut_branded.mp4"),
    'thumbnails': len(glob(f"{OUTDIR}/thumbnails/thumbnail_v*_yt.png")) >= 4,
    'seo_meta': os.path.exists(f"{OUTDIR}/youtube_meta.json"),
}
```

Print plan:
```
Detected state for <project_name>:
  Narrator text:    32/40 cinematic scenes ✓
  TTS files:        32/32 ✓
  Text overlays:    [missing]      ← will run
  Music:            [skipped]      ← --with-music not set
  Narrator-cut:     [missing]      ← will run
  Branded:          [missing]      ← will run
  Thumbnails:       [missing]      ← will run
  SEO meta:         [missing]      ← will run

Stages to execute:
  [SKIP]   /fk-gen-narrator (already done)
  [RUN]    /fk-gen-text-overlays
  [SKIP]   /fk-gen-music (--with-music not set)
  [RUN]    /fk-concat-fit-narrator --4k
  [RUN]    /fk-brand-logo <channel> ... --thumbnails
  [RUN]    /fk-thumbnail
  [RUN]    /fk-youtube-seo
  [RUN]    /fk-youtube-upload --schedule "..."

Proceed? (yes/no)
```

---

## Step 3: Execute stages sequentially

### Stage 1 — Narrator text + TTS (if missing)

```bash
/fk-gen-narrator <VID> --language <lang> --speed 1.1
```

Auto-detects interview vs cinematic, writes `narrator_text` to DB, generates TTS WAVs to `${OUTDIR}/tts/`. Skips if already complete.

### Stage 2 — Text overlays (if `--no-overlays` not set)

```bash
/fk-gen-text-overlays <VID> --language <lang>
```

Writes `${OUTDIR}/text_overlays.json`. Burn happens later in concat.

### Stage 3 — BG Music (if `--with-music`)

```bash
/fk-gen-music
# User picks template (cinematic_epic, military_tension, etc.)
# Output: ${OUTDIR}/music/bg_track.mp3
```

### Stage 4 — Concat-fit-narrator

```bash
/fk-concat-fit-narrator <VID> --4k
```

Trim each scene to TTS duration + 0.5s buffer, mix SFX 30% + TTS 150%, burn overlays, xfade chain segments, concat. Output: `${OUTDIR}/${SLUG}_narrator_cut.mp4`.

**If `--with-music`**, post-process to mix music:
```bash
ffmpeg -y -i "${OUTDIR}/${SLUG}_narrator_cut.mp4" -i "${OUTDIR}/music/bg_track.mp3" \
  -filter_complex "[1:a]volume=0.15,aloop=loop=-1:size=2e9[bg];[0:a][bg]amix=inputs=2:duration=first[aout]" \
  -map 0:v -map "[aout]" -c:v copy -c:a aac -b:a 192k -ar 48000 -ac 2 \
  "${OUTDIR}/${SLUG}_narrator_cut_music.mp4"
mv "${OUTDIR}/${SLUG}_narrator_cut_music.mp4" "${OUTDIR}/${SLUG}_narrator_cut.mp4"
```

### Stage 5 — Brand logo (intro + outro + watermark)

```bash
/fk-brand-logo <channel> "${OUTDIR}/${SLUG}_narrator_cut.mp4"
```

Output: `${OUTDIR}/${SLUG}_narrator_cut_branded.mp4`.

### Stage 6 — Thumbnails (if `--no-thumbnails` not set)

```bash
/fk-thumbnail <PID>
```

Generates 4 variants → `${OUTDIR}/thumbnails/thumbnail_v{1,2,3,4}_yt.png`.

Then apply brand logo to thumbnails:
```bash
/fk-brand-logo <channel> "${OUTDIR}/${SLUG}_narrator_cut_branded.mp4" --thumbnails
```

→ `thumbnail_v{1,2,3,4}_final.png`.

### Stage 7 — YouTube SEO

```bash
/fk-youtube-seo <PID> --language <lang> --channel <channel>
```

Output: `${OUTDIR}/youtube_meta.json` with title, description, hashtags, keywords.

### Stage 8 — Upload (skip if `--dry-run`)

If `--dry-run`:
```
[DRY-RUN] Would upload: ${OUTDIR}/${SLUG}_narrator_cut_branded.mp4
[DRY-RUN] Title: <from youtube_meta.json>
[DRY-RUN] Schedule: <if set, else "immediate">
[DRY-RUN] Thumbnail: <best variant>
```

Else:
```bash
SCHED_FLAG=""
[ -n "$SCHEDULE" ] && SCHED_FLAG="--schedule \"$SCHEDULE\""

/fk-youtube-upload <channel> "${OUTDIR}/${SLUG}_narrator_cut_branded.mp4" $SCHED_FLAG
```

Auto-detects Short vs Long-form. Loads `channel_rules.json` to enforce title/description/tags policy.

---

## Step 4: Final summary

```
✅ Finalize complete: <project_name>
   project_id:   <PID>
   video_id:     <VID>
   channel:      <channel>

Outputs:
   Final video:  ${OUTDIR}/${SLUG}_narrator_cut_branded.mp4 (XXXmb, X:XX, 3840x2160)
   Thumbnails:   ${OUTDIR}/thumbnails/thumbnail_v{1..4}_final.png
   SEO meta:     ${OUTDIR}/youtube_meta.json

YouTube:
   Status:       <published | scheduled | dry-run>
   URL:          https://youtu.be/<id>  (if uploaded)
   Schedule:     <if applicable>
   Type:         <Short | Long-form>

Stages run: <N> (skipped <M> already done)
Wall time: XX:XX
```

---

## Failure Handling

| Failure | Action |
|---------|--------|
| Stage fails mid-chain | Stop, print what completed + what's pending. Don't roll back files (re-running picks up from state). |
| Concat audio = -inf (silent) | Re-run concat with `--buffer 1.0`, check TTS files exist |
| Brand audio dropout | Auto-handled by Stage 5 audio normalization (48kHz stereo); if persists, run `/fk-doctor` |
| Upload `quotaExceeded` | Suggest `--schedule` to delay, or wait 24h |
| `invalid_grant` (YouTube) | Re-auth: `python youtube/auth.py <channel>` |
| Thumbnail fail (no main char) | Continue without thumbnails, warn user |

---

## Resume Behavior

Re-running `/fk-finalize` on partial state = picks up where it left off:

```bash
# First run hit upload quota
/fk-finalize $VID warzone-vn --schedule "tomorrow 08:00"
# → Stage 1-7 complete, Stage 8 fails with quotaExceeded

# Next day, re-run same command
/fk-finalize $VID warzone-vn --schedule "tomorrow 08:00"
# → Detects all earlier outputs exist, skips Stage 1-7, only runs Stage 8
```

State detection (Step 2) ensures idempotency.

---

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| "no narrator text" abort | Pipeline didn't TTS yet | Run `/fk-pipeline --tts` first, or `/fk-gen-narrator <VID>` directly |
| Voice template not found | Channel missing voice_template*.wav | `/fk-import-voice <wav> --channel <channel>` |
| Branded video has no audio | TTS 24kHz mono not normalized | `/fk-brand-logo` Stage 4 auto-normalizes; if persists, manually re-encode |
| Thumbnail looks wrong | Main character has no media_id | `/fk-gen-refs <PID>` to regen refs first |
| Upload says "Title too long" | Channel rules cap < SEO output | Edit `youtube_meta.json` manually, re-run upload only |
| `--with-music` no SUNO_API_KEY | Env var missing | `export SUNO_API_KEY=...` then re-run |

---

## Comparison: Manual vs Finalize

| | Manual (6 lệnh) | `/fk-finalize` |
|---|---|---|
| Commands | 6-7 | 1 |
| State detection | None (re-runs always) | Auto-skip done stages |
| Resume after failure | Manual figure out which stage | Auto from `/fk-finalize` re-run |
| Pre-flight checks | Per skill (each one separately) | Once upfront, fail fast |
| Dry-run | Per skill | `--dry-run` flag global |

---

## Full Auto-From-Topic Pipeline

Combine with `/fk-script` and `/fk-pipeline`:

```bash
/fk-script "Operation Tapalpa CJNG 2026" --language vi --scenes 40 --orientation H
# → review scenes table, type 'yes'

/fk-pipeline --upscale --tts --download --notify
# → ~60-90 min auto rendering

/fk-finalize $VID warzone-vn --schedule "tomorrow 08:00"
# → ~10 min auto post-prod + publish
```

3 commands, ~2 hours wall-clock, ~15 min hands-on time.
