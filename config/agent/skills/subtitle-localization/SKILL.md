---
name: subtitle-localization
description: Create or translate local movie/TV subtitle files with ffprobe/ffmpeg extraction, SRT cleanup, chunked AI translation, EN↔RU direction support, and validation. Use when asked to extract subtitles from media, generate subtitles from audio, translate .srt files, or create English/Russian subtitles for a local video.
---

# Subtitle Localization

Use this skill to create a subtitle file for a local media file or translate an existing subtitle file. The common fast path is: inspect media → extract embedded text subtitles → clean duplicate cues → split into chunks → translate chunks → merge → validate.

Supported primary directions:

- Russian → English (`ru` → `en`)
- English → Russian (`en` → `ru`)

## Inputs to establish

If not provided, infer or ask for:

- Input path: media file (`.mkv`, `.mp4`, etc.) or subtitle file (`.srt`, `.ass`, `.vtt`).
- Source language: usually `ru` or `en`.
- Target language: usually `en` or `ru`.
- Subtitle stream preference when multiple streams exist.
- Any name/style preferences or glossary entries.

Default output naming:

```text
<Movie.Stem>.<target-lang>.srt
```

For intermediate files, use:

```text
<Movie.Stem>.<source-lang>.srt
<Movie.Stem>.<source-lang>.clean.srt
<Movie.Stem>_subtitle_translation_chunks/
```

## Prerequisites

Check local tools first:

```bash
command -v ffprobe >/dev/null && command -v ffmpeg >/dev/null && echo "ffmpeg tools installed"
```

Optional fallback tools for audio transcription:

```bash
for c in whisper faster-whisper whisperx mlx_whisper; do command -v "$c" >/dev/null && echo "$c: $(command -v "$c")"; done
```

## Workflow

### 1. Inspect the media or subtitle source

For media files, inspect streams:

```bash
ffprobe -hide_banner -i "INPUT.mkv" 2>&1 | sed -n '1,180p'
ffprobe -v error -select_streams s \
  -show_entries stream=index,codec_name:stream_tags=language,title \
  -of table "INPUT.mkv"
```

Classify subtitle streams:

- Text subtitles: `subrip`, `ass`, `ssa`, `mov_text`, `webvtt` — extract/convert directly to SRT.
- Bitmap subtitles: `hdmv_pgs_subtitle`, `dvd_subtitle`/VobSub — extract first, then OCR outside this skill unless an OCR tool is clearly available.
- No subtitles: transcribe audio with Whisper/faster-whisper if installed.

If the user provides an existing `.srt`, skip extraction and go to cleanup.

### 2. Extract or create source-language SRT

For an embedded text subtitle stream:

```bash
ffmpeg -y -hide_banner -loglevel error \
  -i "INPUT.mkv" \
  -map 0:s:0 -c:s srt \
  "INPUT_STEM.ru.srt"
```

Adjust `0:s:0` for the chosen subtitle stream and the output language suffix for the source language.

For bitmap subtitles, extract the stream and explain that OCR is required:

```bash
ffmpeg -y -hide_banner -loglevel error \
  -i "INPUT.mkv" \
  -map 0:s:0 "INPUT_STEM.subs.sup"
```

Recommended OCR path: Subtitle Edit, Tesseract, or another subtitle OCR tool to produce a source `.srt`, then resume this workflow.

For no usable subtitles, transcribe audio when a Whisper CLI is available. Examples:

```bash
whisper "INPUT.mkv" --language Russian --task transcribe --output_format srt --output_dir .
whisper "INPUT.mkv" --language English --task transcribe --output_format srt --output_dir .
```

Use transcription only when extraction/OCR is unavailable or poor, because embedded subtitles usually have better timing.

### 3. Clean and normalize SRT

Use the helper scripts from this skill directory. Resolve paths relative to this `SKILL.md` file.

```bash
python3 scripts/clean_srt.py "INPUT_STEM.ru.srt" -o "INPUT_STEM.ru.clean.srt"
```

Default cleanup:

- normalizes newlines to LF,
- trims trailing whitespace,
- removes consecutive exact duplicate cues by matching timestamp + text,
- renumbers cues sequentially.

Use `--duplicate-policy none` when duplicate cues are intentional.

### 4. Split long SRTs into translation chunks

For more than about 150 cues, split before AI translation:

```bash
python3 scripts/split_srt.py "INPUT_STEM.ru.clean.srt" \
  --out-dir "INPUT_STEM_subtitle_translation_chunks" \
  --prefix ru \
  --chunk-size 110
```

For English → Russian, use `--prefix en`.

### 5. Create a chunk translation guide

Write a `TRANSLATION_GUIDE.md` inside the chunk directory so every translation lane follows the same rules. Include any movie-specific glossary discovered from the source subtitles or provided by the user.

Base guide:

```markdown
# Subtitle translation guide

Translate the SRT chunk to natural, concise target-language subtitles.

Rules:
- Preserve SRT cue numbers and timestamps exactly.
- Translate only cue text. Do not add, remove, merge, or reorder cues.
- Keep one blank line between cues.
- Preserve simple formatting tags like <i>...</i> when present.
- Preserve dialogue structure where useful: leading dashes, speaker labels, and line breaks.
- Translate SDH captions/sound descriptions: `(тревожная музыка)` ↔ `(tense music)`.
- Prefer concise subtitle language over literal word-for-word phrasing.
- Do not include Markdown/code fences/commentary in the output file.

Direction:
- Source language: SOURCE_LANG
- Target language: TARGET_LANG

Glossary / name preferences:
- Add names and recurring terms here before translation.
```

Direction notes:

- `ru` → `en`: transliterate names consistently; warn if Cyrillic remains in final English output.
- `en` → `ru`: translate dialogue naturally into Russian; keep established Latin brand/person names only when appropriate; warn on cues with no Cyrillic.
- Songs: translate lyrics naturally and keep italics if present. If exact lyric translation is culturally important, flag it in the final response.

### 6. Translate chunks

For a small file, translate directly in the main session. For a movie-sized file, use parallel subagents or a workflow so each chunk is isolated and easier to validate.

Subagent task template:

```text
Translate subtitle chunk `SOURCE_PREFIX.partNN.srt` from SOURCE_LANG to TARGET_LANG.
Read `TRANSLATION_GUIDE.md` first.
Write valid SRT to `TARGET_PREFIX.partNN.srt` in the same directory.
Preserve cue numbers and timestamps exactly; translate cue text only; no markdown/commentary.
After writing, run:
python3 ABSOLUTE_SKILL_DIR/scripts/validate_srt.py SOURCE_PREFIX.partNN.srt TARGET_PREFIX.partNN.srt --source-lang SOURCE_LANG --target-lang TARGET_LANG
Return only a short status and validator warnings; do not include subtitle contents.
```

Use source/target prefixes like:

- `ru.part01.srt` → `en.part01.srt`
- `en.part01.srt` → `ru.part01.srt`

### 7. Merge translated chunks

```bash
python3 scripts/merge_srt_parts.py \
  -o "INPUT_STEM.en.srt" \
  "INPUT_STEM_subtitle_translation_chunks"/en.part*.srt
```

Use `.ru.srt` and `ru.part*.srt` for English → Russian.

### 8. Validate final output

Always validate against the cleaned source SRT:

```bash
python3 scripts/validate_srt.py \
  "INPUT_STEM.ru.clean.srt" \
  "INPUT_STEM.en.srt" \
  --source-lang ru \
  --target-lang en
```

For English → Russian:

```bash
python3 scripts/validate_srt.py \
  "INPUT_STEM.en.clean.srt" \
  "INPUT_STEM.ru.srt" \
  --source-lang en \
  --target-lang ru
```

Also check that ffmpeg/libav accepts the SRT:

```bash
ffprobe -v error -show_entries format=duration \
  -of default=noprint_wrappers=1:nokey=1 \
  "INPUT_STEM.en.srt" >/tmp/subtitle-ffprobe.log 2>&1 \
  && echo "ffprobe accepted SRT" \
  || { echo "ffprobe failed"; tail -80 /tmp/subtitle-ffprobe.log; exit 1; }
```

Validation warnings do not always mean failure. Review them and fix obvious untranslated cues before finalizing.

## Quality checklist before final response

- Source SRT was extracted/transcribed or the provided SRT was used.
- Cleaned SRT exists and duplicate removal count was reported when relevant.
- Final target SRT exists at the expected path.
- Final cue count, cue numbers, and timestamps match the cleaned source.
- Target-language leftover warnings were checked.
- `ffprobe` accepts the final SRT.
- Final response lists the output file and any intermediate files worth keeping.

## Common pitfalls

- Embedded subtitle stream indexes in ffmpeg are relative (`0:s:0`, `0:s:1`), not necessarily the absolute stream number shown as `#0:2`.
- Movie releases sometimes include duplicated subtitle cues. Remove only exact timestamp+text duplicates unless there is evidence broader dedupe is safe.
- ASS/SSA subtitles may contain styling that is lost when converting to SRT; preserve only meaningful text and simple italics.
- OCR and Whisper are fallback paths; embedded text subtitles generally provide better timing.
- Do not let translation agents renumber each chunk from 1. Chunk files must preserve original cue numbers so merging and final validation are reliable.
