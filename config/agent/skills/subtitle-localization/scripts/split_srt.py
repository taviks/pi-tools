#!/usr/bin/env python3
"""Split an SRT file into numbered parts while preserving cue numbers/timestamps."""

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


def write_srt(path: Path, cues: list[Cue]) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for cue in cues:
            handle.write(f"{cue.number}\n{cue.timestamp}\n")
            for line in cue.text:
                handle.write(f"{line}\n")
            handle.write("\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="Split an SRT into translation chunks.")
    parser.add_argument("input", type=Path, help="Source .srt file")
    parser.add_argument("--out-dir", type=Path, required=True, help="Directory to write chunks into")
    parser.add_argument("--prefix", default=None, help="Output prefix, e.g. ru -> ru.part01.srt")
    parser.add_argument("--chunk-size", type=int, default=110, help="Cues per part. Default: 110")
    parser.add_argument("--force", action="store_true", help="Allow writing into an existing output directory")
    args = parser.parse_args()

    if args.chunk_size < 1:
        raise ValueError("--chunk-size must be at least 1")

    cues = parse_srt(args.input)
    out_dir = args.out_dir
    if out_dir.exists() and not args.force:
        existing_parts = sorted(out_dir.glob("*.part*.srt"))
        if existing_parts:
            raise FileExistsError(f"{out_dir} already contains part files; use --force to continue")
    out_dir.mkdir(parents=True, exist_ok=True)

    prefix = args.prefix or args.input.stem
    written: list[Path] = []
    for part_index, start in enumerate(range(0, len(cues), args.chunk_size), 1):
        part_cues = cues[start : start + args.chunk_size]
        path = out_dir / f"{prefix}.part{part_index:02d}.srt"
        write_srt(path, part_cues)
        written.append(path)

    print(f"input cues: {len(cues)}")
    print(f"chunk size: {args.chunk_size}")
    print(f"parts: {len(written)}")
    for path in written:
        print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
