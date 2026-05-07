# fk-script — From Topic to Project + Scenes (Auto Scripting)

Wrap research + scripting into one command: research the topic, design story + entities + N scenes with proper chain structure, then create project/video/scenes via API. User reviews before commit.

Usage: `/fk-script <topic> [--scenes N] [--orientation H|V] [--language vi] [--material realistic] [--channel <name>] [--skip-research]`

- `topic` — subject (e.g. `"Operation Tapalpa CJNG 2026"`)
- `--scenes N` — total scene count (default: 40)
- `--orientation H|V` — HORIZONTAL (default) or VERTICAL
- `--language` — narrator/overlay language (default: vi)
- `--material` — visual style: `realistic | 3d_pixar | anime | stop_motion | minecraft | oil_painting` (default: realistic)
- `--channel` — channel rules to load (e.g. `warzone-vn` for SEO defaults)
- `--skip-research` — reuse existing `plans/research/<slug>.md` instead of re-running

---

## When to Use

- Documentary or fiction with ≥10 scenes
- Real-people content (handles alias EN + back-view rules automatically)
- Repeating a pattern (military/crime/history) with new topic
- Want to skip interactive `/fk-create-project` Q&A

**DO NOT use when:** project has highly custom visual identity, <5 scenes (use `/fk-create-project` interactive), or needs human-driven scene-by-scene direction.

---

## Step 1: Pre-flight

```bash
curl -s http://127.0.0.1:8100/health
# Required: extension_connected: true (else abort, suggest /fk-doctor)
```

---

## Step 2: Research (or reuse)

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

## Step 8: Show scenes table → ask confirm

Before any API call, print:

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

Next steps:
  /fk-pipeline --upscale --tts --download --notify    # render farm
  /fk-finalize <VID> <channel> --schedule "tomorrow 08:00"  # post-prod + publish
```

---

## Failure Handling

| Failure | Action |
|---------|--------|
| Research file missing + `--skip-research` set | Abort, suggest run `/fk-research` first |
| Extension not connected | Abort, suggest `/fk-doctor` |
| Scene POST fails mid-loop | Roll back: DELETE scenes already created, DELETE video, DELETE project. Keep research file. |
| User cancels at review | Discard, no API calls made |
| Real-person not flagged but should be | User can `edit N` at review or run again |

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

| Feature | `/fk-create-project` | `/fk-script` |
|---------|---------------------|--------------|
| Style | Interactive Q&A | Single command + auto |
| Best for | <10 scenes, fiction | ≥10 scenes, docu, real-people |
| Research integration | No | Yes (auto reads `plans/research/<slug>.md`) |
| Time for 40 scenes | ~30 min typing | ~2 min Claude + 5 min user review |
| Real-people handling | User must remember rules | Auto-detected + applied |
