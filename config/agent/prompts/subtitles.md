---
description: Extract, translate, or generate local movie subtitles with validation
argument-hint: "<media-or-srt> [source-lang] [target-lang] [notes]"
---

Create or translate subtitles using the `subtitle-localization` skill.

Input/request:

```text
$ARGUMENTS
```

If the input path or language direction is missing or ambiguous, ask a concise follow-up. Otherwise, run the workflow end-to-end:

1. Inspect/extract or use the provided subtitle source.
2. Clean duplicate/normalized cues.
3. Split into chunks if the subtitle file is long.
4. Translate in the requested direction (`ru`↔`en` unless otherwise specified).
5. Merge chunks.
6. Validate cue counts, numbering, timestamps, target-language leftovers, and SRT parseability.
7. Report the final `.srt` path and any warnings.
