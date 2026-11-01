#!/usr/bin/env python3
"""Offline checks for the low-risk path heuristics used by gitlab-low-risk-merge.sh."""
from __future__ import annotations
import re
import sys

BLOCKED = re.compile(
    r"(^|/)\.gitlab-ci\.yml$|(^|/)Dockerfile|(^|/)package-lock\.json$|(^|/)pnpm-lock\.yaml$|"
    r"(^|/)yarn\.lock$|(^|/)go\.sum$|migration|auth|payment|oauth|secret|k8s|helm|deploy",
    re.I,
)

def assess(paths: list[str], adds: int, dels: int, max_lines=50, max_files=3) -> list[str]:
    reasons = []
    if len(paths) > max_files:
        reasons.append("files")
    if adds + dels > max_lines:
        reasons.append("lines")
    for p in paths:
        if BLOCKED.search(p):
            reasons.append(p)
    return reasons

def main() -> int:
    assert assess(["src/views/Copy.tsx"], 10, 2) == []
    assert "files" in assess(["a.ts", "b.ts", "c.ts", "d.ts"], 1, 1)
    assert "lines" in assess(["a.ts"], 40, 20)
    assert any("auth" in r for r in assess(["src/auth/login.ts"], 1, 1))
    assert assess(["docs/README.md"], 3, 1) == []
    print("PASS gitlab-low-risk-merge-selftest")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
