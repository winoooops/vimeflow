"""
Claude Code CLI Subprocess Client
=================================

Spawns `claude -p --output-format stream-json --verbose ...` as a subprocess
per harness role, parses the JSONL event stream, and yields SDK-shaped events
(AssistantMessage / UserMessage / TextBlock / ToolUseBlock / ToolResultBlock /
ResultEvent) so agent.py's existing event loop is untouched.

Auth is inherited from the user's Claude Code CLI — no ANTHROPIC_API_KEY
required on this path.
"""

import json
from dataclasses import dataclass
from typing import Any, Optional, Union


@dataclass
class TextBlock:
    text: str


@dataclass
class ToolUseBlock:
    name: str
    input: dict


@dataclass
class ToolResultBlock:
    content: Any
    is_error: bool = False


@dataclass
class AssistantMessage:
    content: list[Union[TextBlock, ToolUseBlock]]


@dataclass
class UserMessage:
    content: list[ToolResultBlock]


@dataclass
class ResultEvent:
    session_id: str
    is_error: bool
    subtype: Optional[str] = None


Event = Union[AssistantMessage, UserMessage, ResultEvent]


def parse_stream_event(line: str) -> Optional[Event]:
    """Parse one JSONL line from `claude -p --output-format stream-json`.

    Returns None for lines that carry no event we surface (system init,
    hook wrappers, thinking blocks, empty lines, malformed JSON)."""
    line = line.strip()
    if not line:
        return None
    try:
        obj = json.loads(line)
    except json.JSONDecodeError:
        return None

    event_type = obj.get("type")

    if event_type == "assistant":
        blocks: list[Union[TextBlock, ToolUseBlock]] = []
        for raw in obj.get("message", {}).get("content", []) or []:
            kind = raw.get("type")
            if kind == "text":
                blocks.append(TextBlock(text=raw.get("text", "")))
            elif kind == "tool_use":
                blocks.append(ToolUseBlock(
                    name=raw.get("name", ""),
                    input=raw.get("input", {}) or {},
                ))
            # "thinking" and any future unknown block types are skipped.
        return AssistantMessage(content=blocks)

    if event_type == "user":
        tool_results: list[ToolResultBlock] = []
        for raw in obj.get("message", {}).get("content", []) or []:
            if isinstance(raw, dict) and raw.get("type") == "tool_result":
                tool_results.append(ToolResultBlock(
                    content=raw.get("content", ""),
                    is_error=bool(raw.get("is_error", False)),
                ))
        return UserMessage(content=tool_results)

    if event_type == "result":
        return ResultEvent(
            session_id=obj.get("session_id", ""),
            is_error=bool(obj.get("is_error", False)),
            subtype=obj.get("subtype"),
        )

    return None
