"""Tests for harness prompt assembly."""

from __future__ import annotations

from prompts import get_coding_prompt, get_coding_prompt_with_findings


def test_get_coding_prompt_omits_visual_section_without_design_ref() -> None:
    prompt = get_coding_prompt({"id": 1, "description": "Backend feature"})

    assert not prompt.startswith("## Visual reference")
    assert "## YOUR ROLE - CODING AGENT" in prompt


def test_get_coding_prompt_prepends_visual_reference_section() -> None:
    feature = {
        "id": 8,
        "description": "Visual feature",
        "design_ref": {
            "surface": "agent_status_sidebar",
            "prototype_url": "https://example.invalid/prototype",
            "spec_paths": [
                "docs/design/UNIFIED.md",
                "docs/design/agent_status_sidebar/code.html",
            ],
            "screenshot_paths": [
                "docs/design/agent_status_sidebar/references/test-results/desktop-1440x900.png",
            ],
        },
        "visual_review": {
            "fixture_url": "/__visual__/agent-status/test-results",
            "viewports": [
                {"name": "desktop-1440x900", "width": 1440, "height": 900},
            ],
        },
    }

    prompt = get_coding_prompt(feature)

    assert prompt.startswith("## Visual reference")
    assert "- Surface: `agent_status_sidebar`" in prompt
    assert "- Prototype URL: https://example.invalid/prototype" in prompt
    assert "- `docs/design/UNIFIED.md`" in prompt
    assert "- `docs/design/agent_status_sidebar/code.html`" in prompt
    assert (
        "- `docs/design/agent_status_sidebar/references/test-results/desktop-1440x900.png`"
        in prompt
    )
    assert "- Visual fixture URL: `/__visual__/agent-status/test-results`" in prompt
    assert "  - desktop-1440x900 (1440x900)" in prompt
    assert "## YOUR ROLE - CODING AGENT" in prompt


def test_get_coding_prompt_with_findings_keeps_visual_reference_first() -> None:
    feature = {
        "design_ref": {
            "screenshot_paths": ["docs/design/chat_or_main/screen.png"],
        },
    }

    prompt = get_coding_prompt_with_findings("VIS-1: spacing mismatch", feature)

    assert prompt.startswith("## Visual reference")
    assert "- `docs/design/chat_or_main/screen.png`" in prompt
    assert "## REVIEW FINDINGS FROM PREVIOUS ITERATION" in prompt
    assert "VIS-1: spacing mismatch" in prompt
