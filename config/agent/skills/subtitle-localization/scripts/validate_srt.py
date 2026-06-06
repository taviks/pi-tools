#!/usr/bin/env python3
"""Validate that a translated SRT preserves the reference cue structure."""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path

CYRILLIC_RE = re.compile(r"[А-Яа-яЁё]")
LATIN_RE = re.compile(r"[A-Za-z]")
WORDISH_RE = re.compile(r"[A-Za-zА-Яа-яЁё]")


@dataclass
class Cue:
    number: str
    timestamp: str
    text: list[str]

    @property
    def body(self) -> str:
        return "\n".join(self.text).strip()


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


def structure_errors(reference: list[Cue], candidate: list[Cue]) -> list[str]:
    errors: list[str] = []
    if len(reference) != len(candidate):
        errors.append(f"cue count mismatch: reference {len(reference)} vs candidate {len(candidate)}")

    for position, (ref, got) in enumerate(zip(reference, candidate), 1):
        if ref.number != got.number:
            errors.append(f"position {position}: cue number mismatch: {ref.number!r} vs {got.number!r}")
        if ref.timestamp != got.timestamp:
            errors.append(f"cue {ref.number}: timestamp mismatch: {ref.timestamp!r} vs {got.timestamp!r}")
    return errors


def language_warnings(reference: list[Cue], candidate: list[Cue], source_lang: str | None, target_lang: str | None) -> list[str]:
    warnings: list[str] = []

    if target_lang == "en":
        cyrillic_cues = [cue.number for cue in candidate if CYRILLIC_RE.search(cue.body)]
        if cyrillic_cues:
            warnings.append("Cyrillic remains in target English cues: " + ", ".join(cyrillic_cues[:40]) + ("..." if len(cyrillic_cues) > 40 else ""))

    if target_lang == "ru":
        # A Russian subtitle can legitimately contain Latin names, URLs, or song titles,
        # so warn on the higher-signal case: source cue had words but target cue has no Cyrillic.
        no_cyrillic = [
            got.number
            for ref, got in zip(reference, candidate)
            if WORDISH_RE.search(ref.body) and not CYRILLIC_RE.search(got.body)
        ]
        if no_cyrillic:
            warnings.append("Target Russian cues with no Cyrillic text: " + ", ".join(no_cyrillic[:40]) + ("..." if len(no_cyrillic) > 40 else ""))

    if source_lang == "en" and target_lang == "ru":
        latin_heavy = []
        for cue in candidate:
            body_without_tags = re.sub(r"<[^>]+>", "", cue.body)
            latin_chars = len(LATIN_RE.findall(body_without_tags))
            cyrillic_chars = len(CYRILLIC_RE.findall(body_without_tags))
            if latin_chars >= 20 and latin_chars > cyrillic_chars:
                latin_heavy.append(cue.number)
        if latin_heavy:
            warnings.append("Latin-heavy target Russian cues: " + ", ".join(latin_heavy[:40]) + ("..." if len(latin_heavy) > 40 else ""))

    empty_cues = [cue.number for cue in candidate if not cue.body]
    if empty_cues:
        warnings.append("Empty translated cue bodies: " + ", ".join(empty_cues[:40]) + ("..." if len(empty_cues) > 40 else ""))

    return warnings


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate translated SRT cue structure against a reference SRT.")
    parser.add_argument("reference", type=Path, help="Reference/source .srt")
    parser.add_argument("candidate", type=Path, help="Translated .srt")
    parser.add_argument("--source-lang", choices=["en", "ru", "auto"], default="auto")
    parser.add_argument("--target-lang", choices=["en", "ru", "auto"], default="auto")
    parser.add_argument("--strict", action="store_true", help="Exit nonzero on warnings as well as errors")
    args = parser.parse_args()

    reference = parse_srt(args.reference)
    candidate = parse_srt(args.candidate)
    errors = structure_errors(reference, candidate)
    source_lang = None if args.source_lang == "auto" else args.source_lang
    target_lang = None if args.target_lang == "auto" else args.target_lang
    warnings = language_warnings(reference, candidate, source_lang, target_lang)

    if errors:
        print("ERRORS:", file=sys.stderr)
        for error in errors[:50]:
            print(f"- {error}", file=sys.stderr)
        if len(errors) > 50:
            print(f"... {len(errors) - 50} more", file=sys.stderr)
        return 1

    print(f"OK: {len(candidate)} cues; numbering/timestamps match")
    if warnings:
        print("WARNINGS:")
        for warning in warnings:
            print(f"- {warning}")
        return 1 if args.strict else 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
