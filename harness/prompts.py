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


def copy_spec_to_project(project_dir: Path) -> None:
    """Copy app_spec.md into the project directory for the agent to read."""
    spec_src = PROMPTS_DIR / "app_spec.md"
    spec_dst = project_dir / "app_spec.md"

    if spec_src.exists() and not spec_dst.exists():
        shutil.copy2(spec_src, spec_dst)
        print(f"  Copied app_spec.md to {spec_dst}")
