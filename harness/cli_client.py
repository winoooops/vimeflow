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

import asyncio
import json
import uuid
from dataclasses import dataclass
from pathlib import Path
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


class ClaudeCliSession:
    """One harness role bound to one Claude conversation.

    First `query()` call: `claude <prompt> -p --session-id <uuid> ...`.
    Subsequent `query()` calls: `claude <prompt> -p --resume <uuid> ...`.

    Note: the prompt is placed as the first positional argument (immediately
    after `claude`) because `claude -p` otherwise sometimes treats a
    subsequent flag's value as the prompt and errors with "Input must be
    provided either through stdin or as a prompt argument".

    Implements the async context-manager protocol as a no-op so callers
    can treat CLI and SDK sessions uniformly (`async with session:`). The
    SDK backend's `ClaudeSDKClient` actually needs the enter/exit for its
    internal subprocess lifecycle; we don't, but offering the same surface
    eliminates `isinstance(session, ClaudeCliSession)` branching in
    agent.py.
    """

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    # Default per-query deadline. `claude -p` can stall indefinitely if the
    # network goes away, auth expires mid-stream, or the CLI itself
    # deadlocks. The SDK backend got implicit timeouts from httpx; the
    # subprocess backend has none — without this the harness hangs forever
    # rather than surfacing a RuntimeError the orchestrator can retry.
    DEFAULT_QUERY_TIMEOUT_SECONDS = 600.0  # 10 minutes

    def __init__(
        self,
        *,
        role: str,
        project_dir: Path,
        model: str,
        settings_path: Path,
        allowed_tools: list[str],
        timeout: float = DEFAULT_QUERY_TIMEOUT_SECONDS,
    ):
        self.role = role
        self.project_dir = project_dir
        self.model = model
        self.settings_path = settings_path
        self.allowed_tools = allowed_tools
        self.timeout = timeout
        self.session_id = str(uuid.uuid4())
        self._started = False

    def _build_args(self, prompt: str, resume: bool) -> list[str]:
        # `--tools` (exclusive surface) vs `--allowed-tools` (permissive):
        # `--allowed-tools` under `bypassPermissions` only marks the listed
        # tools as allowed; it does NOT remove the rest of Claude Code's
        # default tools or configured MCP tools from the session, which
        # means an agent could invoke a tool our hooks never see. `--tools`
        # restricts the session to exactly the listed built-ins (and is
        # comma-separated, unlike `--allowed-tools`'s space-separated list).
        args = [
            "claude",
            prompt,
            "-p",
            "--output-format", "stream-json",
            "--verbose",
            "--model", self.model,
            "--settings", str(self.settings_path),
            "--tools", ",".join(self.allowed_tools),
        ]
        if resume:
            args += ["--resume", self.session_id]
        else:
            args += ["--session-id", self.session_id]
        return args

    async def query(self, prompt: str, *, timeout: Optional[float] = None):
        """Spawn `claude -p` and yield parsed events as they arrive.

        If the subprocess stalls (network failure, auth expiry mid-stream,
        CLI deadlock), the whole read loop is cancelled after `timeout`
        seconds (default: `self.timeout`) and the process is killed. The
        generator raises `asyncio.TimeoutError` so the orchestrator can
        decide whether to retry. Without this the SDK-era httpx-level
        timeouts are lost and the harness hangs forever.
        """
        deadline = timeout if timeout is not None else self.timeout
        args = self._build_args(prompt, resume=self._started)
        proc = await asyncio.create_subprocess_exec(
            *args,
            cwd=str(self.project_dir),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        # Set _started after a successful spawn. If create_subprocess_exec
        # raises (e.g. `claude` not on PATH), the flag stays False and a
        # retry correctly re-uses --session-id. If the process spawns but
        # exits non-zero (auth expired mid-session), we reset the flag in
        # the RuntimeError branch below so retries don't try --resume
        # against a session that never got persisted.
        self._started = True

        # Drain stderr concurrently. The OS pipe buffer is ~64 KB on Linux;
        # if `claude -p` writes more (verbose stack traces, debug logs)
        # while we're still blocked on stdout, the child eventually blocks
        # on its stderr write and nothing ever unsticks. Always reading
        # stderr in a side task prevents the deadlock and lets us surface
        # the message on non-zero exit.
        stderr_chunks: list[bytes] = []

        async def _drain_stderr() -> None:
            assert proc.stderr is not None
            while True:
                chunk = await proc.stderr.read(4096)
                if not chunk:
                    break
                stderr_chunks.append(chunk)

        stderr_task = asyncio.create_task(_drain_stderr())

        try:
            assert proc.stdout is not None
            # asyncio.timeout() is the 3.11+ context-manager form; cancels
            # every await inside and surfaces a clean TimeoutError. The
            # finally block below kills the process and resets _started.
            async with asyncio.timeout(deadline):
                async for raw_line in proc.stdout:
                    line = raw_line.decode("utf-8", errors="replace")
                    event = parse_stream_event(line)
                    if event is not None:
                        yield event
                return_code = await proc.wait()
                await stderr_task
            if return_code != 0:
                # Roll back so a retry uses --session-id not --resume.
                self._started = False
                err = b"".join(stderr_chunks).decode("utf-8", errors="replace")
                raise RuntimeError(
                    f"claude -p exited {return_code}: {err[:500]}"
                )
        finally:
            if proc.returncode is None:
                # Process was still live when the generator exited —
                # usually asyncio.CancelledError from an outer timeout.
                # Kill it, and roll back _started: the session UUID we
                # assigned was never persisted by the CLI, so a later
                # query() call must create a fresh session rather than
                # --resume into a ghost. Without this reset the first
                # post-cancel retry wastes one round-trip discovering
                # the session doesn't exist.
                self._started = False
                proc.kill()
                await proc.wait()
            if not stderr_task.done():
                stderr_task.cancel()
                try:
                    await stderr_task
                except (asyncio.CancelledError, Exception):
                    pass
