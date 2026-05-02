"""
Prompt Loading
==============

Load prompt templates from the prompts/ directory.
"""

import shutil
from pathlib import Path

PROMPTS_DIR = Path(__file__).parent / "prompts"


def load_prompt(name: str) -> str:
    prompt_path = PROMPTS_DIR / f"{name}.md"
    return prompt_path.read_text()


def get_initializer_prompt() -> str:
    return load_prompt("initializer_prompt")


def _list_items(values: object) -> list[str]:
    if not isinstance(values, list):
        return []

    return [value.strip() for value in values if isinstance(value, str) and value.strip()]


def get_visual_reference_section(feature: dict | None) -> str:
    """Build the optional visual-reference section for a selected feature."""
    if not feature:
        return ""

    design_ref = feature.get("design_ref")
    if not isinstance(design_ref, dict):
        return ""

    spec_paths = _list_items(design_ref.get("spec_paths"))
    screenshot_paths = _list_items(design_ref.get("screenshot_paths"))
    prototype_url = design_ref.get("prototype_url")
    surface = design_ref.get("surface")

    visual_review = feature.get("visual_review")
    fixture_url = None
    viewports: list[str] = []
    if isinstance(visual_review, dict):
        maybe_fixture_url = visual_review.get("fixture_url")
        if isinstance(maybe_fixture_url, str) and maybe_fixture_url.strip():
            fixture_url = maybe_fixture_url

        maybe_viewports = visual_review.get("viewports")
        if isinstance(maybe_viewports, list):
            for viewport in maybe_viewports:
                if isinstance(viewport, dict):
                    name = viewport.get("name")
                    width = viewport.get("width")
                    height = viewport.get("height")
                    if (
                        isinstance(name, str)
                        and isinstance(width, int)
                        and isinstance(height, int)
                    ):
                        viewports.append(f"{name} ({width}x{height})")
                    elif isinstance(name, str):
                        viewports.append(name)

    if not (
        spec_paths
        or screenshot_paths
        or prototype_url
        or surface
        or fixture_url
        or viewports
    ):
        return ""

    lines = [
        "## Visual reference",
        "",
        "This feature has a visual target. Before implementing, inspect the relevant local assets.",
    ]

    if isinstance(surface, str) and surface.strip():
        lines.extend(["", f"- Surface: `{surface}`"])

    if isinstance(prototype_url, str) and prototype_url.strip():
        lines.extend(["", f"- Prototype URL: {prototype_url}"])

    if spec_paths:
        lines.extend(["", "- Design specs:"])
        lines.extend(f"  - `{path}`" for path in spec_paths)

    if screenshot_paths:
        lines.extend(["", "- Reference screenshots:"])
        lines.extend(f"  - `{path}`" for path in screenshot_paths)

    if fixture_url:
        lines.extend(["", f"- Visual fixture URL: `{fixture_url}`"])

    if viewports:
        lines.extend(["", "- Visual review viewports:"])
        lines.extend(f"  - {viewport}" for viewport in viewports)

    lines.extend(
        [
            "",
            "Use these assets as ground truth for spacing, hierarchy, depth, "
            "and state. Do not rely only on prose in app_spec.md.",
        ]
    )

    return "\n".join(lines) + "\n\n---\n\n"


def get_coding_prompt(feature: dict | None = None) -> str:
    return get_visual_reference_section(feature) + load_prompt("coding_prompt")


def get_reviewer_prompt(findings: str) -> str:
    """Load reviewer prompt with findings injected."""
    template = load_prompt("reviewer_prompt")
    return template.replace("{findings}", findings)


def get_coding_prompt_with_findings(findings: str, feature: dict | None = None) -> str:
    """Load coding prompt with review findings appended for fix iterations."""
    base = get_coding_prompt(feature)
    review_section = (
        "\n\n---\n\n"
        "## REVIEW FINDINGS FROM PREVIOUS ITERATION\n\n"
        "The following issues were found by the code reviewer (Codex). "
        "Address these findings as part of your implementation work:\n\n"
        f"{findings}\n\n"
        "For each finding: fix it if valid, skip if false positive (explain why)."
    )
    return base + review_section


def copy_spec_to_project(project_dir: Path) -> None:
    """Copy app_spec.md into the project directory for the agent to read."""
    spec_src = PROMPTS_DIR / "app_spec.md"
    spec_dst = project_dir / "app_spec.md"

    if spec_src.exists() and not spec_dst.exists():
        shutil.copy2(spec_src, spec_dst)
        print(f"  Copied app_spec.md to {spec_dst}")
