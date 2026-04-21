import json
from pathlib import Path

from cli_client import (
    parse_stream_event,
    AssistantMessage,
    UserMessage,
    TextBlock,
    ToolUseBlock,
    ToolResultBlock,
    ResultEvent,
)

FIXTURE = Path(__file__).parent / "fixtures" / "stream_sample.jsonl"


def test_parse_assistant_text_block():
    line = json.dumps({
        "type": "assistant",
        "message": {"content": [{"type": "text", "text": "Hello from Claude."}]}
    })
    event = parse_stream_event(line)
    assert isinstance(event, AssistantMessage)
    assert len(event.content) == 1
    block = event.content[0]
    assert isinstance(block, TextBlock)
    assert block.text == "Hello from Claude."


def test_parse_assistant_tool_use_block():
    line = json.dumps({
        "type": "assistant",
        "message": {"content": [{"type": "tool_use", "name": "Read", "input": {"file_path": "/tmp/x"}}]}
    })
    event = parse_stream_event(line)
    assert isinstance(event, AssistantMessage)
    block = event.content[0]
    assert isinstance(block, ToolUseBlock)
    assert block.name == "Read"
    assert block.input == {"file_path": "/tmp/x"}


def test_parse_user_tool_result_block():
    line = json.dumps({
        "type": "user",
        "message": {"content": [{"type": "tool_result", "content": "ok", "is_error": False}]}
    })
    event = parse_stream_event(line)
    assert isinstance(event, UserMessage)
    assert len(event.content) == 1
    block = event.content[0]
    assert isinstance(block, ToolResultBlock)
    assert block.content == "ok"
    assert block.is_error is False


def test_parse_system_line_returns_none():
    assert parse_stream_event(json.dumps({"type": "system", "subtype": "init"})) is None


def test_parse_result_line_returns_result_event():
    line = json.dumps({"type": "result", "subtype": "success", "session_id": "abc", "is_error": False})
    event = parse_stream_event(line)
    assert isinstance(event, ResultEvent)
    assert event.session_id == "abc"
    assert event.is_error is False
    assert event.subtype == "success"


def test_parse_empty_or_invalid_line_returns_none():
    assert parse_stream_event("") is None
    assert parse_stream_event("   ") is None
    assert parse_stream_event("not json") is None


def test_parse_full_fixture_produces_events():
    events = []
    with open(FIXTURE) as f:
        for line in f:
            event = parse_stream_event(line)
            if event is not None:
                events.append(event)
    assert any(isinstance(e, AssistantMessage) for e in events)
    assert any(isinstance(e, UserMessage) for e in events)
    result_events = [e for e in events if isinstance(e, ResultEvent)]
    assert len(result_events) == 1
    assert result_events[0].session_id
    assert result_events[0].is_error is False


import os
import pytest
from cli_client import ClaudeCliSession


def test_cli_session_builds_new_session_args(tmp_path):
    settings = tmp_path / "settings.json"
    settings.write_text("{}")
    session = ClaudeCliSession(
        role="coder",
        project_dir=tmp_path,
        model="claude-sonnet-4-5-20250929",
        settings_path=settings,
        allowed_tools=["Read", "Write", "Bash"],
    )
    args = session._build_args(prompt="hello", resume=False)
    assert args[0] == "claude"
    # Prompt is the first positional AFTER `claude` — Claude CLI bails on --print otherwise
    assert args[1] == "hello"
    assert "-p" in args
    assert "--output-format" in args and "stream-json" in args
    assert "--verbose" in args
    assert "--settings" in args and str(settings) in args
    assert "--session-id" in args
    uuid_idx = args.index("--session-id") + 1
    import uuid as _uuid
    _uuid.UUID(args[uuid_idx])
    # Exclusive tool surface — `--tools` (comma-separated), not
    # `--allowed-tools` (space-separated, permissive). See _build_args.
    assert "--tools" in args
    tools_idx = args.index("--tools") + 1
    assert args[tools_idx] == "Read,Write,Bash"
    assert "--allowed-tools" not in args
    assert "--resume" not in args


def test_cli_session_resume_uses_prior_session_id(tmp_path):
    settings = tmp_path / "settings.json"
    settings.write_text("{}")
    session = ClaudeCliSession(
        role="coder",
        project_dir=tmp_path,
        model="claude-sonnet-4-5-20250929",
        settings_path=settings,
        allowed_tools=["Read"],
    )
    first = session._build_args(prompt="p1", resume=False)
    first_uuid = first[first.index("--session-id") + 1]
    second = session._build_args(prompt="p2", resume=True)
    assert "--resume" in second
    assert second[second.index("--resume") + 1] == first_uuid
    assert "--session-id" not in second


def test_query_drains_stderr_without_deadlock(tmp_path, monkeypatch):
    """A child that floods stderr beyond the pipe buffer must not hang the reader.

    Pre-fix: query() only read stderr after proc.wait(), so a child writing
    >64 KB to stderr blocked on its own write while we were stuck waiting
    for stdout EOF. Post-fix: stderr is drained concurrently.

    We stub _build_args to a Python one-liner that writes 200 KB to stderr,
    emits one JSON result line on stdout, and exits 0 — large enough to
    deadlock pre-fix on a standard 64 KB Linux pipe buffer.
    """
    import asyncio
    import sys

    settings = tmp_path / "settings.json"
    settings.write_text("{}")
    session = ClaudeCliSession(
        role="stderr-drain",
        project_dir=tmp_path,
        model="claude-sonnet-4-5-20250929",
        settings_path=settings,
        allowed_tools=["Read"],
    )

    payload = (
        "import sys; sys.stderr.write('X' * 200_000); "
        "print('{\"type\":\"result\",\"subtype\":\"success\","
        "\"session_id\":\"x\",\"is_error\":false}'); "
        "sys.stderr.flush(); sys.exit(0)"
    )
    monkeypatch.setattr(
        session, "_build_args", lambda prompt, resume: [sys.executable, "-c", payload]
    )

    async def run():
        events = []
        async for event in session.query("ignored"):
            events.append(event)
        return events

    # asyncio.wait_for is the safety net — if the fix regresses, this
    # times out instead of hanging the suite forever.
    events = asyncio.run(asyncio.wait_for(run(), timeout=10))
    result_events = [e for e in events if isinstance(e, ResultEvent)]
    assert len(result_events) == 1 and not result_events[0].is_error


def test_query_times_out_on_stalled_subprocess(tmp_path, monkeypatch):
    """A `claude -p` that never closes stdout (network hang / auth expiry
    mid-stream) must NOT hang the harness forever. Pre-fix: query() had
    no timeout; the SDK path's httpx-level timeout was lost in the
    subprocess refactor. Post-fix: asyncio.timeout around the stdout
    read loop raises TimeoutError and the finally block kills the
    process + resets _started.

    Stub _build_args to a Python one-liner that prints one JSON line
    then sleeps 30s — far longer than the 2s timeout we pass in."""
    import asyncio
    import sys

    settings = tmp_path / "settings.json"
    settings.write_text("{}")
    session = ClaudeCliSession(
        role="stall",
        project_dir=tmp_path,
        model="claude-sonnet-4-5-20250929",
        settings_path=settings,
        allowed_tools=["Read"],
        timeout=2.0,
    )

    payload = (
        "import sys, time; "
        "print('{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"hi\"}]}}', flush=True); "
        "time.sleep(30); "
        "sys.exit(0)"
    )
    monkeypatch.setattr(
        session, "_build_args", lambda prompt, resume: [sys.executable, "-c", payload]
    )

    async def run():
        events = []
        async for event in session.query("ignored"):
            events.append(event)
        return events

    # asyncio.wait_for as the test-level safety net. If the fix regresses
    # the `async for` inside query() would never exit and this would time
    # out at 10s instead of the session's configured 2s.
    with pytest.raises((asyncio.TimeoutError, TimeoutError)):
        asyncio.run(asyncio.wait_for(run(), timeout=10))

    # After timeout, a retry should use --session-id (new uuid), not
    # --resume — the previous session was killed before persisting.
    assert session._started is False


@pytest.mark.skipif(
    not os.environ.get("HARNESS_CLI_LIVE_TEST"),
    reason="live test — set HARNESS_CLI_LIVE_TEST=1 and ensure `claude` CLI is authenticated",
)
def test_cli_session_live_query(tmp_path):
    import asyncio
    settings = tmp_path / "settings.json"
    settings.write_text("{}")
    session = ClaudeCliSession(
        role="smoke",
        project_dir=tmp_path,
        model="claude-sonnet-4-5-20250929",
        settings_path=settings,
        allowed_tools=["Read"],
    )

    async def run():
        events = []
        async for event in session.query("Reply with exactly the single word: SMOKE_OK"):
            events.append(event)
        return events

    events = asyncio.run(run())
    assert any(
        isinstance(e, AssistantMessage)
        and any(isinstance(b, TextBlock) and "SMOKE_OK" in b.text for b in e.content)
        for e in events
    )
    results = [e for e in events if isinstance(e, ResultEvent)]
    assert len(results) == 1 and not results[0].is_error


# ---------- SDK translator (agent.py fallback) ----------


class _FakeSDKTextBlock:
    """Minimal duck-type stand-in — mimics the SDK's TextBlock shape by name."""
    def __init__(self, text: str):
        self.text = text


class _FakeSDKAssistantMessage:
    def __init__(self, content: list):
        self.content = content


def test_translate_sdk_event_assistant_text():
    from agent import _translate_sdk_event, AssistantMessage, TextBlock
    sdk_msg = _FakeSDKAssistantMessage(content=[_FakeSDKTextBlock("hi from SDK")])
    # Rename so class-name lookup treats it as the known AssistantMessage type
    _FakeSDKAssistantMessage.__name__ = "AssistantMessage"
    _FakeSDKTextBlock.__name__ = "TextBlock"
    out = _translate_sdk_event(sdk_msg)
    assert isinstance(out, AssistantMessage)
    assert isinstance(out.content[0], TextBlock)
    assert out.content[0].text == "hi from SDK"


def test_translate_sdk_event_unknown_type_warns_returns_none(capsys):
    from agent import _translate_sdk_event
    class AssistantTurn:  # hypothetical SDK rename
        content: list = []
    out = _translate_sdk_event(AssistantTurn())
    assert out is None
    captured = capsys.readouterr()
    assert "Unknown SDK event type 'AssistantTurn'" in captured.out
