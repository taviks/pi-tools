#!/usr/bin/env python3
"""Normalize an SRT file and optionally remove duplicate cues.

The default duplicate policy removes consecutive cues with the same timestamp and
text. This matches a common muxing artifact where SDH/text subtitles appear twice
back-to-back in extracted tracks.
"""

from __future__ import annotations

import argparse
import re
from dataclasses import dataclass
from pathlib import Path

TIME_ARROW = "-->"


@dataclass
class Cue:
    number: str
    timestamp: str
    text: list[str]


def parse_srt(path: Path) -> list[Cue]:
    text = path.read_text(encoding="utf-8-sig").replace("\r\n", "\n").replace("\r", "\n")
    blocks = [block for block in re.split(r"\n\s*\n", text.strip()) if block.strip()]
    cues: list[Cue] = []
    for block_no, block in enumerate(blocks, 1):
        lines = [line.rstrip() for line in block.splitlines()]
        if len(lines) < 2:
            raise ValueError(f"{path}: malformed block {block_no}: expected at least 2 lines")
        number = lines[0].strip()
        timestamp = lines[1].strip()
        if not number.isdigit():
            raise ValueError(f"{path}: malformed block {block_no}: nonnumeric cue number {number!r}")
        if TIME_ARROW not in timestamp:
            raise ValueError(f"{path}: cue {number}: missing timestamp arrow: {timestamp!r}")
        cues.append(Cue(number=number, timestamp=timestamp, text=lines[2:]))
    return cues


def cue_key(cue: Cue) -> tuple[str, str]:
    return (cue.timestamp, "\n".join(line.strip() for line in cue.text).strip())


def clean_cues(cues: list[Cue], duplicate_policy: str) -> tuple[list[Cue], int]:
    cleaned: list[Cue] = []
    removed = 0
    seen: set[tuple[str, str]] = set()
    previous: tuple[str, str] | None = None

    for cue in cues:
        key = cue_key(cue)
        duplicate = False
        if duplicate_policy == "consecutive":
            duplicate = key == previous
        elif duplicate_policy == "all":
            duplicate = key in seen
        elif duplicate_policy == "none":
            duplicate = False
        else:  # argparse prevents this.
            raise AssertionError(f"unknown duplicate policy {duplicate_policy!r}")

        if duplicate:
            removed += 1
        else:
            cleaned.append(cue)
            seen.add(key)
        previous = key

    return cleaned, removed


def write_srt(path: Path, cues: list[Cue], renumber: bool) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for index, cue in enumerate(cues, 1):
            number = str(index) if renumber else cue.number
            handle.write(f"{number}\n{cue.timestamp}\n")
            for line in cue.text:
                handle.write(f"{line}\n")
            handle.write("\n")


def default_output_path(input_path: Path) -> Path:
    if input_path.suffix.lower() == ".srt":
        return input_path.with_name(f"{input_path.stem}.clean.srt")
    return input_path.with_suffix(f"{input_path.suffix}.clean.srt")


def main() -> int:
    parser = argparse.ArgumentParser(description="Normalize SRT newlines/spacing and remove duplicate cues.")
    parser.add_argument("input", type=Path, help="Source .srt file")
    parser.add_argument("-o", "--output", type=Path, help="Output .srt path; defaults to <input>.clean.srt")
    parser.add_argument(
        "--duplicate-policy",
        choices=["consecutive", "all", "none"],
        default="consecutive",
        help="Duplicate removal policy. Default: consecutive",
    )
    parser.add_argument(
        "--preserve-numbers",
        action="store_true",
        help="Do not renumber cues after cleaning. Default: renumber sequentially",
    )
    args = parser.parse_args()

    input_path = args.input
    output_path = args.output or default_output_path(input_path)
    cues = parse_srt(input_path)
    cleaned, removed = clean_cues(cues, args.duplicate_policy)
    write_srt(output_path, cleaned, renumber=not args.preserve_numbers)

    print(f"input cues: {len(cues)}")
    print(f"output cues: {len(cleaned)}")
    print(f"removed duplicates: {removed}")
    print(f"wrote: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
