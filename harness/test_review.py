"""Tests for review module — parsing and validation."""

from review import parse_codex_output, parse_cloud_review_comment


def test_parse_codex_output_no_findings():
    output = """OpenAI Codex v0.114.0
--------
codex
No actionable issues were found."""
    result = parse_codex_output(output)
    assert result["has_findings"] is False
    assert result["findings"] == []


def test_parse_codex_output_with_findings():
    output = """thinking
**Found issue**
Some thinking text
codex
Found 2 issues:
1. [HIGH] Missing error handling in src/app.ts:42
   The function does not handle the error case.
2. [MEDIUM] Unused import in src/utils.ts:1
   Remove unused import."""
    result = parse_codex_output(output)
    assert result["has_findings"] is True
    assert result["raw_review"] != ""


def test_parse_cloud_review_comment_json():
    body = '''## Codex Code Review

### 🟠 [HIGH] Missing error handling

📍 `src/app.ts` L42-45
🎯 Confidence: 85%

The function does not handle the error case.

---

**Overall: ⚠️ patch has issues** (confidence: 78%)

> One maintainability issue found.'''
    result = parse_cloud_review_comment(body)
    assert result["has_findings"] is True
    assert "Missing error handling" in result["raw_review"]


def test_parse_cloud_review_comment_clean():
    body = '''## Codex Code Review

✅ No issues found.

**Overall: ✅ patch is correct** (confidence: 92%)

> No issues introduced by the diff.'''
    result = parse_cloud_review_comment(body)
    assert result["has_findings"] is False
