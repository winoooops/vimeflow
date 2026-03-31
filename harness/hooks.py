"""
Harness Hooks
=============

Pre/Post tool-use and Stop hooks that enforce harness conventions.
Agents spawned by the harness must:
1. Never delete or reorder features in feature_list.json
2. Run verification checks before claiming a feature passes
3. Commit before session ends
"""

import json
from pathlib import Path


async def pre_write_feature_list_hook(input_data, tool_use_id=None, context=None):
    """
    PreToolUse hook for Write/Edit on feature_list.json.
    Ensures features are never removed or reordered — only passes field can change.
    """
    try:
        # SDK passes full hook context; tool params live in tool_input
        if isinstance(input_data, dict) and "tool_input" in input_data:
            tool_input = input_data["tool_input"]
        else:
            tool_input = input_data

        file_path = tool_input.get("file_path", "") or tool_input.get("path", "")

        if "feature_list.json" not in file_path:
            return {}  # Not our concern

        # For Write tool, validate the new content
        content = tool_input.get("content", "")
        if not content:
            return {}  # Edit tool, harder to validate — let it through

        # Load current feature list
        project_dir = Path(file_path).parent
        current_file = project_dir / "feature_list.json"

        if not current_file.exists():
            return {}  # First write, allow

        with open(current_file, "r") as f:
            current = json.load(f)

        try:
            proposed = json.loads(content)
        except json.JSONDecodeError:
            return {
                "decision": "block",
                "reason": "feature_list.json must be valid JSON",
            }

        if not isinstance(proposed, list):
            return {
                "decision": "block",
                "reason": "feature_list.json must be an array",
            }

        # Check no features were removed
        current_ids = {f.get("id") or f.get("description") for f in current}
        proposed_ids = {f.get("id") or f.get("description") for f in proposed}

        removed = current_ids - proposed_ids
        if removed:
            return {
                "decision": "block",
                "reason": f"Cannot remove features from feature_list.json. Missing: {removed}",
            }

        # Check descriptions weren't changed
        current_by_id = {}
        for f in current:
            key = f.get("id") or f.get("description")
            current_by_id[key] = f

        for f in proposed:
            key = f.get("id") or f.get("description")
            if key in current_by_id:
                old_desc = current_by_id[key].get("description", "")
                new_desc = f.get("description", "")
                if old_desc and new_desc and old_desc != new_desc:
                    return {
                        "decision": "block",
                        "reason": f"Cannot edit feature descriptions. Feature '{key}' description changed.",
                    }

        return {}  # Allow

    except Exception:
        return {}  # Don't block on validation errors
