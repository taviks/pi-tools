#!/usr/bin/env python3
"""Merge translated SRT chunk files into one SRT file."""

from __future__ import annotations

import argparse
import re
from dataclasses import dataclass
from pathlib import Path


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
        if "-->" not in timestamp:
            raise ValueError(f"{path}: cue {number}: missing timestamp arrow: {timestamp!r}")
        cues.append(Cue(number=number, timestamp=timestamp, text=lines[2:]))
    return cues


def write_srt(path: Path, cues: list[Cue], renumber: bool) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for index, cue in enumerate(cues, 1):
            number = str(index) if renumber else cue.number
            handle.write(f"{number}\n{cue.timestamp}\n")
            for line in cue.text:
                handle.write(f"{line}\n")
            handle.write("\n")


def natural_part_key(path: Path) -> tuple[str, int, str]:
    match = re.search(r"part(\d+)", path.name, flags=re.IGNORECASE)
    if match:
        return (path.name[: match.start()], int(match.group(1)), path.name)
    return (path.name, -1, path.name)


def main() -> int:
    parser = argparse.ArgumentParser(description="Merge SRT part files.")
    parser.add_argument("parts", nargs="+", type=Path, help="Part files, e.g. chunks/en.part*.srt")
    parser.add_argument("-o", "--output", type=Path, required=True, help="Merged output .srt")
    parser.add_argument("--renumber", action="store_true", help="Renumber cues sequentially in the merged output")
    args = parser.parse_args()

    parts = sorted(args.parts, key=natural_part_key)
    cues: list[Cue] = []
    for part in parts:
        cues.extend(parse_srt(part))

    write_srt(args.output, cues, renumber=args.renumber)
    print(f"parts: {len(parts)}")
    print(f"cues: {len(cues)}")
    print(f"wrote: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
