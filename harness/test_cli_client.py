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
