#!/usr/bin/env python3
"""Validate local links and executable helper references in vendored skills.

Run from any working directory. Markdown links resolve from their containing
file; command-style paths (scripts/, references/, prompts/, templates/) in a
SKILL.md resolve from that skill's root directory.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path
from urllib.parse import unquote

REPO_ROOT = Path(__file__).resolve().parents[2]
SKILLS_ROOT = REPO_ROOT / ".agents" / "skills"
MARKDOWN_LINK = re.compile(r"!?[^\[]*\[([^\]]*)\]\(([^)]+)\)")
REFERENCE_LINK = re.compile(r"^\s*\[[^\]]+\]:\s*(\S+)", re.MULTILINE)
INLINE_ASSET = re.compile(
    r"(?<![\w./-])((?:\.\.?/)?(?:scripts|references|prompts|templates)/[A-Za-z0-9._/-]+)"
)
FENCED_BLOCK = re.compile(r"(?ms)^[ \t]*([\x60~]{3,}).*?^[ \t]*\1[ \t]*$")
IGNORED_EXAMPLES = {"scripts/tool.sh", "scripts/tool.js"}


def local_target(raw: str) -> str | None:
    target = raw.strip().strip("<>").split()[0]
    if target.startswith(("https://", "http://", "mailto:", "data:", "#")):
        return None
    target = unquote(target.split("#", 1)[0])
    return target or None


def main() -> int:
    if not SKILLS_ROOT.is_dir():
        print(f"ERROR: skills directory not found: {SKILLS_ROOT}", file=sys.stderr)
        return 2

    errors: list[str] = []
    markdown_files = sorted(SKILLS_ROOT.rglob("*.md"))
    for doc in markdown_files:
        source = doc.read_text(encoding="utf-8")
        # Links inside fenced examples describe hypothetical layouts, not assets.
        text = FENCED_BLOCK.sub("", source)
        for match in MARKDOWN_LINK.finditer(text):
            raw = local_target(match.group(2))
            if raw is None:
                continue
            target = (doc.parent / raw).resolve()
            if not target.exists():
                errors.append(f"{doc.relative_to(REPO_ROOT)}: missing Markdown target {raw}")
        for match in REFERENCE_LINK.finditer(text):
            raw = local_target(match.group(1))
            if raw is None:
                continue
            target = (doc.parent / raw).resolve()
            if not target.exists():
                errors.append(f"{doc.relative_to(REPO_ROOT)}: missing reference target {raw}")

    for skill_doc in sorted(SKILLS_ROOT.glob("*/SKILL.md")):
        source = skill_doc.read_text(encoding="utf-8")
        text = FENCED_BLOCK.sub("", source)
        skill_root = skill_doc.parent
        for match in INLINE_ASSET.finditer(text):
            raw = match.group(1).rstrip(".,;:)")
            if raw in IGNORED_EXAMPLES:
                continue
            target = (skill_root / raw).resolve()
            if not target.exists():
                errors.append(
                    f"{skill_doc.relative_to(REPO_ROOT)}: missing referenced asset {raw}"
                )

    if errors:
        print("Skill asset validation: FAIL")
        for error in errors:
            print(f" - {error}")
        return 1

    print(
        f"Skill asset validation: PASS "
        f"({len(markdown_files)} Markdown files, "
        f"{len(list(SKILLS_ROOT.glob('*/SKILL.md')))} skills)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
