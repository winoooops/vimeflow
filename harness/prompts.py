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


def get_coding_prompt() -> str:
    return load_prompt("coding_prompt")


def get_reviewer_prompt(findings: str) -> str:
    """Load reviewer prompt with findings injected."""
    template = load_prompt("reviewer_prompt")
    return template.replace("{findings}", findings)


def get_coding_prompt_with_findings(findings: str) -> str:
    """Load coding prompt with review findings appended for fix iterations."""
    base = load_prompt("coding_prompt")
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
