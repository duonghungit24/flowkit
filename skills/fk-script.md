# fk-script — From Topic (or Pre-Written Script) to Project + Scenes

Two modes, one command:

1. **Topic mode** (default) — research the topic, AI-design story + entities + N scenes with chain structure, then create project/video/scenes via API.
2. **From-script mode** (`--from-script <file>`) — load a pre-written script file (JSON), skip research + AI design, POST directly to API.

Both modes support `--auto` to chain `/fk-pipeline` + `/fk-finalize` after commit for full end-to-end run.

Usage:
```
/fk-script <topic> [flags]                       # Topic mode (AI generates everything)
/fk-script --from-script <file> [flags]          # From-script mode (use your file)
```

- `topic` — subject (e.g. `"Operation Tapalpa CJNG 2026"`). Required in topic mode, ignored in from-script mode.
- `--from-script <file>` — path to script JSON file. When set, skips research + AI design. See "From-Script Mode" section for schema.
- `--scenes N` — total scene count (default: 40). Ignored in from-script mode (count comes from file).
- `--orientation H|V` — HORIZONTAL (default) or VERTICAL. Ignored in from-script mode (read from file).
- `--language` — narrator/overlay language (default: vi). Ignored in from-script mode (read from file).
- `--material` — visual style: `realistic | 3d_pixar | anime | stop_motion | minecraft | oil_painting` (default: realistic). Ignored in from-script mode (read from file).
- `--channel` — channel rules to load (e.g. `warzone-vn` for SEO defaults). Required when `--auto`.
- `--skip-research` — reuse existing `plans/research/<slug>.md` instead of re-running. Topic mode only.
- `--auto` — after commit, automatically chain into `/fk-pipeline` then `/fk-finalize` for full end-to-end run.
- `--yes` — skip Step 8 review gate (auto-confirm script). Implied by `--auto`.
- `--no-upload` — stop after concat (skip YouTube upload). Requires `--auto`.
- `--schedule "..."` — passed through to `/fk-finalize` (e.g. `"tomorrow 08:00"`).

---

## When to Use

**Topic mode:**
- Documentary or fiction with ≥10 scenes
- Real-people content (handles alias EN + back-view rules automatically)
- Repeating a pattern (military/crime/history) with new topic
- Want to skip interactive `/fk-create-project` Q&A

**From-script mode:**
- Script already written tay (scenes, prompts, characters all defined)
- Reuse a template script across multiple projects with small edits
- Migrating an existing project spec from another tool
- Full control — no AI guessing prompts

**DO NOT use when:** <5 scenes and want interactive guidance (use `/fk-create-project`).

---

## From-Script Mode

When `--from-script <file>` is set, skill skips Step 2-7 entirely and jumps to validation → review → commit.

### Script JSON schema

```json
{
  "name": "Operation Tapalpa CJNG 2026",
  "story": "7-10 sentence story summary used by narrator + thumbnail copy",
  "material": "realistic",
  "language": "vi",
  "orientation": "HORIZONTAL",
  "characters": [
    {
      "name": "The Cartel Boss",
      "entity_type": "character",
      "description": "Late-50s, broad shoulders, black tactical vest, seen from behind...",
      "real_reference": "Nemesio 'El Mencho' Oseguera"
    },
    {
      "name": "Tapalpa Mountains",
      "entity_type": "location",
      "description": "Pine-forested ridges in Jalisco at dawn..."
    }
  ],
  "scenes": [
    {
      "display_order": 0,
      "prompt": "Wide aerial shot of Tapalpa peaks at dawn, mist rolling through valleys.",
      "video_prompt": "0-3s: Slow push-in over ridges. 3-6s: Sun rises behind peaks. 6-8s: Camera tilts down toward base. Audio: ambient wind. SFX: distant bird calls. Negative: subtitles, watermark, text overlay.",
      "character_names": ["Tapalpa Mountains"],
      "chain_type": "ROOT"
    },
    {
      "display_order": 16,
      "prompt": "Low-angle Black Hawk emerging from mist over ridge line.",
      "video_prompt": "0-3s: ... 3-6s: ... 6-8s: ...",
      "character_names": ["Black Hawk Helicopter", "Tapalpa Mountains"],
      "chain_type": "ROOT"
    },
    {
      "display_order": 17,
      "prompt": "Door gunner POV, ridge sweeping past at high speed.",
      "video_prompt": "0-3s: ... 3-6s: ... 6-8s: ...",
      "character_names": ["Black Hawk Helicopter"],
      "chain_type": "CONTINUATION",
      "parent_display_order": 16,
      "transition_prompt": "Camera moves from exterior low-angle to door gunner first-person view, ridge sweeping past at high speed."
    }
  ]
}
```

### Field rules

| Field | Required | Notes |
|---|---|---|
| `name` | yes | Project name |
| `story` | yes | 7-10 sentences, used by `/fk-finalize` for SEO + thumbnail |
| `material` | yes | One of 6 built-ins or custom material slug |
| `language` | yes | ISO code (`vi`, `en`, ...) |
| `orientation` | yes | `HORIZONTAL` or `VERTICAL` |
| `characters[]` | yes | Min 1 entity. Each needs `name` (English alias), `entity_type`, `description` |
| `characters[].real_reference` | optional | Real person name if alias-based. Saved to research mapping for audit. |
| `scenes[]` | yes | Min 1 scene |
| `scenes[].display_order` | yes | 0-indexed, must be unique |
| `scenes[].prompt` | yes | Image prompt (frame 0). NO appearance — refs handle it. |
| `scenes[].video_prompt` | yes | 8s breakdown + Audio/SFX/Negative |
| `scenes[].character_names` | yes | Array of entity names visible in scene. Must match `characters[].name` |
| `scenes[].chain_type` | yes | `ROOT` or `CONTINUATION` |
| `scenes[].parent_display_order` | required for CONTINUATION | Refers to `display_order` of parent scene |
| `scenes[].transition_prompt` | required for CONTINUATION scenes that have children | Describes start→end frame trajectory |

### Validation (before any API call)

1. JSON parses
2. All required fields present
3. `scenes[].character_names` references existing `characters[].name`
4. `CONTINUATION` scenes have valid `parent_display_order` pointing to existing ROOT or CONTINUATION
5. No duplicate `display_order`
6. `parent_display_order` < own `display_order` (parent must come before child)
7. If real-people content detected (via `real_reference`), apply real-people rules check (camera angles in prompts, back-view in descriptions). Warn if any scene `prompt` describes character facing camera.

On any validation error → abort with line-by-line error report, no API calls.

---

## Step 1: Pre-flight

```bash
curl -s http://127.0.0.1:8100/health
# Required: extension_connected: true (else abort, suggest /fk-doctor)
```

---

## Step 2: Research (or reuse) — **SKIPPED in from-script mode**

**If `--from-script <file>` is set:** skip this step entirely. Jump to Step 7.5 (validation).

Otherwise (topic mode):

If `--skip-research` AND `plans/research/<slug>.md` exists → load it.

Else:
```bash
/fk-research "<topic>" --language <lang> --depth deep
```

Wait for research file at `plans/research/<slug>.md`. Read it fully — extract:
- **Timeline** — key dates, milestones
- **Real figures** — full names + titles (will be aliased)
- **Operations** — code names, locations
- **Casualties / numbers** — for overlays
- **Outcome** — for narrative resolution

---

## Step 3: Detect real-people content

Scan research for any of: presidents, prime ministers, military commanders, celebrities, well-known criminals (cartel bosses, etc.).

If detected → flag `REAL_PEOPLE_MODE = true`. Apply rules from `/fk-create-project` "Real-People Characters" section:
- Entity `name` = role-based alias **in English** (`The Cartel Boss`, never `El Mencho`)
- Entity `description` = physical features only, no real names
- Famous person ref = back view OR left-side three-quarter profile
- Scene prompts keep camera behind/beside character
- `narrator_text` CAN use real names (audio doesn't feed generator)
- Maintain `real_reference` mapping table

---

## Step 4: Design story (7-10 sentences)

Extract from research → write story:
1. **Setup** — when/where/who
2. **Conflict** — what triggers events
3. **Stakes** — what's at risk
4. **Action** — key escalation
5. **Climax** — peak moment
6. **Resolution** — outcome
7. **Significance** — why it matters

Match `--language`. Keep tone consistent with `--material` (realistic = grave, anime = stylized, 3d_pixar = warm).

---

## Step 5: Design entities (3-7 total)

For each, pick `entity_type`: `character | location | visual_asset | creature | faction`.

**Mandatory fields:**
- `name` — alias EN if real-people, else descriptive (`Castle Gate`, `Magic Wand`)
- `entity_type`
- `description` — physical only, **1 outfit** for characters, no scene-specific variants

**Real-people characters:**
- Add to description: `"seen from behind, [hair], [build], [signature clothing], full silhouette head to toe"`
- Or: `"seen from the left side three-quarter profile"`

**Print mapping table for user review:**

```
Entity            | Type      | Real Reference | Description (truncated)
------------------|-----------|----------------|-------------------------
The Cartel Boss   | character | Nemesio "El Mencho" Oseguera | Late-50s, broad shoulders, black tactical vest...
The Field Cmdr   | character | (fictional)    | 40s Mexican Marine, tactical helmet, FX-05 rifle...
Tapalpa Mountains | location  | -              | Pine-forested ridges in Jalisco at dawn...
Black Hawk Heli   | visual_asset | -          | UH-60 in Mexican Marine livery...
Wanted Poster $15M| visual_asset | -          | Government-issued FBI-style poster...
```

---

## Step 6: Design narrative arc + chain structure

For `N` scenes (default 40), distribute by phase:

| Phase | % of scenes | chain_type pattern |
|-------|-------------|-------------------|
| Setup | 12% (5) | All `ROOT` |
| Rising | 25% (10) | Mostly `ROOT`, occasional 2-3 scene chains |
| Climax | 25% (10) | Mostly `CONTINUATION` chains for action sequences |
| Resolution | 25% (10) | Mix of `ROOT` + short chains |
| Epilogue | 13% (5) | `ROOT` |

**Parallel timelines = separate chains.** If story intercuts 2 characters (defector + pursuer), build 2 chains:
```
Chain A: scene_09 ROOT → 10 → 12 → 14
Chain B: scene_11 ROOT → 13 → 15
```
Interleave by `display_order`.

**Never chain different primary characters** — `EDIT_IMAGE` morph causes face drift.

---

## Step 7: Write scene prompts

For each scene, produce:

| Field | Rule |
|-------|------|
| `display_order` | 0-indexed sequential |
| `prompt` | English. Image (frame 0): `[camera/angle]. [subject + action]. [environment + lighting].` NO appearance. |
| `video_prompt` | English. 8s breakdown: `0-3s: ... 3-6s: ... 6-8s: ...` + `Audio: ... SFX: ... Negative: subtitles, watermark, text overlay.` |
| `transition_prompt` | Only if scene has CONTINUATION child. Describes full trajectory start→end frame. Else empty. |
| `character_names` | All entities visible: characters + locations + assets |
| `chain_type` | `ROOT` or `CONTINUATION` |
| `parent_scene_id` | Only for `CONTINUATION` (filled after parent's scene_id known) |

**CONTINUATION prompt rule:** Describe DESIRED RESULT with explicit camera/angle, NOT a re-description of parent. System auto-prepends "Transform this image into a completely different moment..."

**Real-people scenes:** Camera always behind/beside, never face. Match ref angle.

---

## Step 7.5: Validate from-script file (from-script mode only)

If `--from-script <file>` is set, this is where execution resumes after Step 1.

Run the validation checklist from "From-Script Mode → Validation" section above. On any error → abort, print line-by-line errors, no API calls.

If valid → derive in-memory data structure identical to what Steps 3-7 would produce (entities + scenes table), then proceed to Step 8.

**Slug for output dir** = kebab-case of `name` field.

---

## Step 8: Show scenes table → ask confirm

**If `--yes` or `--auto` is set:** skip interactive review. Print compact summary (entity count, scene count, chain segments) and proceed straight to Step 9. No `edit N` loop, no waiting for input.

Otherwise, before any API call, print:

```
=== SCRIPT REVIEW: <topic> ===
Material: realistic | Orientation: HORIZONTAL | Scenes: 40 | Language: vi

ENTITIES (5):
  The Cartel Boss [character, real:El Mencho, back view]
  The Field Commander [character, fictional]
  Tapalpa Mountains [location]
  Black Hawk Helicopter [visual_asset]
  Wanted Poster $15M [visual_asset]

SCENES:
Order | Chain | Parent | Characters                       | Prompt (60 chars)
------|-------|--------|----------------------------------|------------------
   00 | ROOT  | -      | Tapalpa Mountains                | Wide aerial shot of Tapalpa peaks at dawn...
   01 | ROOT  | -      | Mexico City War Room             | Pan across war room screens showing intel...
  ...
   16 | ROOT  | -      | Black Hawk Heli, Tapalpa Mts     | Low-angle Black Hawk emerging from mist...
   17 | CONT  | 16     | Black Hawk Heli                  | Door gunner POV, ridge sweeping past...
   18 | CONT  | 17     | Field Cmdr, Black Hawk           | Interior cabin, Field Cmdr signals 30 sec...
  ...

Total: 40 scenes, 8 chain segments (climax 16-25, etc.)

Type 'yes' to commit to DB, 'edit N' to modify scene N, or 'cancel'.
```

If user says `edit N` → show full scene N, take new fields, loop until `yes`.

---

## Step 9: POST to API

### 9a. Create project + entities (1 call)

```bash
curl -X POST http://127.0.0.1:8100/api/projects \
  -H "Content-Type: application/json" \
  -d '{
    "name": "<topic_clean>",
    "story": "<7-10 sentence story>",
    "material": "<material>",
    "language": "<lang>",
    "characters": [<entities array>]
  }'
# Save → PID
```

### 9b. Create video

```bash
curl -X POST http://127.0.0.1:8100/api/videos \
  -H "Content-Type: application/json" \
  -d '{"project_id":"<PID>","title":"<topic>","display_order":0,"orientation":"<ORI>"}'
# Save → VID
```

### 9c. Create scenes — 2 passes for parent_scene_id

**Pass 1: ROOT scenes** (no parent)
```bash
for each ROOT scene:
  POST /api/scenes {video_id, display_order, prompt, video_prompt, character_names, chain_type:"ROOT"}
  # Save scene_id keyed by display_order
```

**Pass 2: CONTINUATION scenes** (with parent_scene_id)
```bash
for each CONT scene:
  parent_id = root_ids[parent_display_order]  # resolved from pass 1
  POST /api/scenes {..., chain_type:"CONTINUATION", parent_scene_id: parent_id, transition_prompt:"..."}
```

---

## Step 10: Output

```
✅ Script committed: <topic>
   project_id: <PID>
   video_id:   <VID>
   entities:   5 (3 real-people aliased)
   scenes:     40 (32 ROOT, 8 CONTINUATION across 3 chain segments)

Real reference mapping saved: plans/research/<slug>.md
Output dir: output/<slug>/
```

**If `--auto` NOT set:** print suggested next steps and stop:
```
Next steps:
  /fk-pipeline --upscale --tts --download --notify    # render farm
  /fk-finalize <VID> <channel> --schedule "tomorrow 08:00"  # post-prod + publish
```

---

## Step 11: Auto-chain pipeline + finalize (when `--auto`)

If `--auto` is set, continue without further prompts.

### 11a. Run `/fk-pipeline`

Invoke `/fk-pipeline <PID> <ORI> --upscale --tts --download --notify` and wait for completion.

**On failure** (extension drop, quota, captcha exhaustion): abort chain, print:
```
⚠ Pipeline failed mid-run. Resume with:
  /fk-pipeline <PID> --upscale --tts --download --notify
Skip the finalize step until pipeline reports DONE.
```
Do NOT auto-retry — surface the failure so user can run `/fk-doctor`.

### 11b. Run `/fk-finalize` (unless `--no-upload`)

If `--no-upload` set: stop after pipeline DONE. Print final concat path + suggested manual finalize command.

Otherwise, require `--channel`. Invoke:
```
/fk-finalize <VID> <channel> [--schedule "<schedule>"]
```
Forward `--schedule` value if provided.

### 11c. Final output

```
✅ Full pipeline done: <topic>
   project_id:   <PID>
   video_id:     <VID>
   render:       DONE (40 scenes, 4K upscaled)
   tts:          DONE
   concat:       output/<slug>/final.mp4
   youtube:      <video_url> (scheduled: <schedule> | published)
```

---

## Failure Handling

| Failure | Action |
|---------|--------|
| Research file missing + `--skip-research` set | Abort, suggest run `/fk-research` first |
| Extension not connected | Abort, suggest `/fk-doctor` |
| Scene POST fails mid-loop | Roll back: DELETE scenes already created, DELETE video, DELETE project. Keep research file / script file. |
| User cancels at review | Discard, no API calls made |
| Real-person not flagged but should be | User can `edit N` at review or run again |
| `--auto` set but `--channel` missing | Abort before Step 9 — channel required for finalize |
| Pipeline fails under `--auto` | Stop chain, print resume command, DO NOT auto-retry |
| Finalize fails under `--auto` | Print resume command `/fk-finalize <VID> <channel>`, keep concat output |
| `--from-script` file not found | Abort, print expected path |
| `--from-script` JSON parse error | Abort, print line + column of error |
| `--from-script` validation fails | Abort, print all errors at once (don't fix-one-and-retry) |
| `--from-script` + `topic` both provided | Use `--from-script`, warn that `topic` arg ignored |

---

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| Entity alias too literal | Not enough escalation | Use full role + descriptor: `The Iron Premier` not just `The Premier` |
| Chain too long (>5) | Over-chained climax | Break into 2-3 chains with ROOT pivots |
| Mixed characters in chain | Wrong chain assignment | Each primary character gets its own chain |
| Scene prompt describes appearance | Forgot rule | Strip appearance, refs handle it |
| `transition_prompt` on ROOT/leaf | Wasted field | Only set on chain scenes WITH a child |

---

## Comparison vs `/fk-create-project`

| Feature | `/fk-create-project` | `/fk-script` topic mode | `/fk-script` from-script |
|---------|---------------------|--------------|----------------------------|
| Style | Interactive Q&A | Single command + AI design | Single command + file load |
| Best for | <10 scenes, fiction | ≥10 scenes, docu, real-people | Script written tay |
| Research integration | No | Yes (auto) | No (use your facts) |
| Time for 40 scenes | ~30 min typing | ~2 min Claude + 5 min review | ~30s (just commit) |
| Real-people handling | User must remember rules | Auto-detected + applied | User-defined in file |
| End-to-end (`--auto`) | No | Yes | Yes |

---

## End-to-End Examples

### Topic mode (AI generates everything)

```bash
/fk-script "Operation Tapalpa CJNG 2026" \
  --scenes 40 --channel warzone-vn \
  --auto --schedule "tomorrow 08:00"
```

Flow:
1. `/fk-research` runs (deep, vi)
2. Script + entities + scenes designed
3. Compact summary printed (no review gate, `--auto` implies `--yes`)
4. Project/video/scenes committed via API
5. `/fk-pipeline` chains automatically: render images → videos → upscale → TTS → download
6. `/fk-finalize` chains automatically: overlays → music → concat → brand → thumbnail → SEO → YouTube upload scheduled at `tomorrow 08:00`
7. Final summary with YouTube URL printed

### From-script mode (use your pre-written script)

```bash
/fk-script --from-script my-episode-01.json \
  --channel warzone-vn \
  --auto --schedule "tomorrow 08:00"
```

Flow:
1. Pre-flight check (extension connected)
2. Skip Step 2-7 (no research, no AI design)
3. Step 7.5: validate `my-episode-01.json` — schema, references, chain integrity
4. Step 8: compact summary printed (review gate skipped due to `--auto`)
5. Step 9: POST project + entities + scenes (2-pass for `parent_scene_id`)
6. Step 11: chain `/fk-pipeline` then `/fk-finalize` — same as topic mode

Validation-only test (no commit):
```bash
/fk-script --from-script my-episode-01.json --dry-run    # TODO: future flag
```
For now, omit `--auto` to stop after Step 8 review, type `cancel` to abort without commit.

If anything fails mid-chain, skill aborts and prints the exact resume command — no silent retries.
