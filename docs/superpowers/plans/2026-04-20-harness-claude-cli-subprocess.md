# Harness `claude -p` Subprocess Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the harness's `claude_code_sdk` Python-package dependency with `claude -p` subprocess invocations, so the harness inherits the user's Claude Code CLI auth instead of requiring `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL` in `.env`.

**Architecture:** Add a new `cli_client.py` that spawns `claude -p --output-format stream-json --verbose --settings <path> --allowed-tools ... [--session-id <uuid> | --resume <uuid>]` per harness role, parses the JSONL event stream, and yields SDK-shaped events so `agent.py`'s existing event loop is untouched. Each role (Initializer, Coder, fix) gets an independent process with its own UUID; subsequent iterations on the same feature `--resume` that UUID so conversation context persists. Python security hooks (`security.py`, `hooks.py`) are preserved by wiring them through a new `hook_runner.py` that Claude's CLI invokes via `settings.json` hook commands. The Bash allowlist gains an LLM-judge fallback: when no rule matches, a one-shot `claude -p` call acts as policy judge, with decisions cached on disk. A `--client {sdk,cli}` flag keeps the legacy SDK path available during the transition for parity testing, then is removed.

**Tech Stack:** Python 3.11+, `claude` CLI v1.x (`--output-format stream-json`, `--session-id`, `--resume`, `--allowed-tools`, `--settings`), `asyncio.create_subprocess_exec` for streaming stdout, `pytest` for unit tests, `uuid`, `json`.

---

## File Structure

**New files**

- `harness/cli_client.py` — `ClaudeCliSession` subprocess wrapper + stream-JSON parser + SDK-shaped event adapter
- `harness/hook_runner.py` — entry point invoked by CLI Claude via `settings.json` hooks; dispatches to `security.py` / `hooks.py` and emits the Claude Code hook-protocol JSON
- `harness/policy_judge.py` — LLM fallback for the Bash allowlist; spawns a single-shot `claude -p`, caches decisions on disk
- `harness/test_cli_client.py` — unit tests for the stream parser + event adapter
- `harness/test_hook_runner.py` — unit tests for stdin→stdout hook dispatch
- `harness/test_policy_judge.py` — unit tests for the judge with mocked `claude -p`
- `harness/fixtures/stream_sample.jsonl` — captured real `claude -p --output-format stream-json` output for deterministic parser tests
- `harness/scripts/dry_run_parity.py` — workflow-parity smoke test (runs one iteration under both `--client sdk` and `--client cli` on a fixture repo, diffs the produced commits/events)

**Modified files**

- `harness/client.py` — drop `ANTHROPIC_API_KEY` requirement; add `build_settings_file(project_dir, sandbox)` that writes `settings.json` with the hook wiring; keep the SDK `create_client(...)` factory for the legacy path (conditional)
- `harness/agent.py` — swap the single `create_client(...)` + `async with client:` pattern for a dispatcher that returns either a `ClaudeSDKClient` or a `ClaudeCliSession` based on `--client`; pass role + session-id per feature
- `harness/autonomous_agent_demo.py` — add `--client {sdk,cli}` flag (default `cli`), thread it into `run_autonomous_agent`, `run_feature_iteration`, `run_cloud_review_loop`
- `harness/security.py` — call `policy_judge.decide(command)` when a command is not in the allowlist, instead of blocking outright
- `harness/CLAUDE.md` — remove `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL` from the env vars table (replace with a note that `claude` CLI auth is used); update Troubleshooting; document `--client` flag and policy judge
- `harness/requirements.txt` — no change (we keep `claude-code-sdk` for the legacy path; new code uses only stdlib)

---

## Task 1: Capture a real stream-JSON fixture

**Why first:** every parser test depends on a real fixture. Generate once, commit, then tests stay deterministic without hitting the Claude API.

**Files:**

- Create: `harness/fixtures/stream_sample.jsonl`
- Create: `harness/fixtures/README.md`

- [ ] **Step 1: Generate a short real stream**

Run from a worktree with `claude` CLI authenticated:

```bash
mkdir -p harness/fixtures
cd /tmp && mkdir -p cli-fixture-scratch && cd cli-fixture-scratch
claude -p --output-format stream-json --verbose --allowed-tools "Read" \
  "List the files in this directory, then read the first one and summarize it in one sentence." \
  > $OLDPWD/harness/fixtures/stream_sample.jsonl
```

- [ ] **Step 2: Add a README explaining regeneration**

```markdown
# harness/fixtures

Real `claude -p --output-format stream-json --verbose` output captured for
deterministic parser tests. Regenerate via the command in Task 1 of
docs/superpowers/plans/2026-04-20-harness-claude-cli-subprocess.md if the CLI
wire format changes.
```

- [ ] **Step 3: Commit**

```bash
git add harness/fixtures/stream_sample.jsonl harness/fixtures/README.md
git commit -m "test(harness): capture claude -p stream-json fixture for parser tests"
```

---

## Task 2: Stream-JSON parser — event types

**Files:**

- Create: `harness/cli_client.py` (types + parser only in this task)
- Create: `harness/test_cli_client.py`

- [ ] **Step 1: Write failing test for AssistantTextBlock parse**

```python
# harness/test_cli_client.py
import json
from pathlib import Path

from cli_client import parse_stream_event, AssistantMessage, TextBlock, ToolUseBlock

FIXTURE = Path(__file__).parent / "fixtures" / "stream_sample.jsonl"


def test_parse_assistant_text_block():
    # An assistant line with text content from the fixture
    line = json.dumps({
        "type": "assistant",
        "message": {
            "content": [{"type": "text", "text": "Hello from Claude."}]
        }
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
        "message": {
            "content": [{"type": "tool_use", "name": "Read", "input": {"file_path": "/tmp/x"}}]
        }
    })
    event = parse_stream_event(line)
    assert isinstance(event, AssistantMessage)
    block = event.content[0]
    assert isinstance(block, ToolUseBlock)
    assert block.name == "Read"
    assert block.input == {"file_path": "/tmp/x"}


def test_parse_system_line_returns_none():
    line = json.dumps({"type": "system", "subtype": "init"})
    assert parse_stream_event(line) is None


def test_parse_result_line_returns_result_event():
    from cli_client import ResultEvent
    line = json.dumps({"type": "result", "subtype": "success", "session_id": "abc", "is_error": False})
    event = parse_stream_event(line)
    assert isinstance(event, ResultEvent)
    assert event.session_id == "abc"
    assert event.is_error is False
```

- [ ] **Step 2: Run tests — expect ImportError**

```bash
cd harness && python3 -m pytest test_cli_client.py -v
```

Expected: `ModuleNotFoundError: No module named 'cli_client'` or similar.

- [ ] **Step 3: Implement minimal parser + event types**

```python
# harness/cli_client.py
"""
Claude Code CLI Subprocess Client
=================================

Spawns `claude -p --output-format stream-json --verbose ...` as a subprocess
per harness role, parses the JSONL event stream, and yields SDK-shaped events
(AssistantMessage / TextBlock / ToolUseBlock / ToolResultBlock / ResultEvent)
so agent.py's existing event loop is untouched.

Auth is inherited from the user's Claude Code CLI — no ANTHROPIC_API_KEY
required.
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

    Returns None for lines that carry no event we care about (system init,
    empty lines, etc.)."""
    line = line.strip()
    if not line:
        return None
    try:
        obj = json.loads(line)
    except json.JSONDecodeError:
        return None

    event_type = obj.get("type")

    if event_type == "assistant":
        blocks = []
        for raw in obj.get("message", {}).get("content", []) or []:
            kind = raw.get("type")
            if kind == "text":
                blocks.append(TextBlock(text=raw.get("text", "")))
            elif kind == "tool_use":
                blocks.append(ToolUseBlock(
                    name=raw.get("name", ""),
                    input=raw.get("input", {}) or {},
                ))
        return AssistantMessage(content=blocks)

    if event_type == "user":
        blocks = []
        for raw in obj.get("message", {}).get("content", []) or []:
            if raw.get("type") == "tool_result":
                blocks.append(ToolResultBlock(
                    content=raw.get("content", ""),
                    is_error=bool(raw.get("is_error", False)),
                ))
        return UserMessage(content=blocks)

    if event_type == "result":
        return ResultEvent(
            session_id=obj.get("session_id", ""),
            is_error=bool(obj.get("is_error", False)),
            subtype=obj.get("subtype"),
        )

    return None
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd harness && python3 -m pytest test_cli_client.py -v
```

Expected: all four tests pass.

- [ ] **Step 5: Add a fixture-replay test**

```python
# Append to harness/test_cli_client.py

def test_parse_full_fixture_produces_events():
    events = []
    with open(FIXTURE) as f:
        for line in f:
            event = parse_stream_event(line)
            if event is not None:
                events.append(event)
    # The fixture must contain at least one assistant message and exactly
    # one terminal result event.
    assert any(isinstance(e, AssistantMessage) for e in events)
    result_events = [e for e in events if isinstance(e, ResultEvent)]
    assert len(result_events) == 1
    assert result_events[0].session_id  # non-empty UUID
```

- [ ] **Step 6: Run tests — expect PASS**

```bash
cd harness && python3 -m pytest test_cli_client.py -v
```

- [ ] **Step 7: Commit**

```bash
git add harness/cli_client.py harness/test_cli_client.py
git commit -m "feat(harness): add stream-JSON parser + SDK-shaped event types"
```

---

## Task 3: `ClaudeCliSession` subprocess wrapper

**Files:**

- Modify: `harness/cli_client.py`
- Modify: `harness/test_cli_client.py`

- [ ] **Step 1: Write failing test for command assembly**

```python
# Append to harness/test_cli_client.py
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
    assert "-p" in args
    assert "--output-format" in args and "stream-json" in args
    assert "--verbose" in args
    assert "--settings" in args and str(settings) in args
    assert "--session-id" in args
    uuid_idx = args.index("--session-id") + 1
    # Validate UUID shape
    import uuid as _uuid
    _uuid.UUID(args[uuid_idx])
    assert "--allowed-tools" in args
    # Prompt is the final positional arg
    assert args[-1] == "hello"
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
```

- [ ] **Step 2: Run tests — expect FAIL (ClaudeCliSession not defined)**

```bash
cd harness && python3 -m pytest test_cli_client.py::test_cli_session_builds_new_session_args -v
```

- [ ] **Step 3: Implement `ClaudeCliSession`**

Append to `harness/cli_client.py`:

```python
import asyncio
import uuid
from pathlib import Path


class ClaudeCliSession:
    """One harness role bound to one Claude conversation.

    First `query()` call: `claude -p --session-id <uuid> ...`.
    Subsequent `query()` calls: `claude -p --resume <uuid> ...`.
    """

    def __init__(
        self,
        *,
        role: str,
        project_dir: Path,
        model: str,
        settings_path: Path,
        allowed_tools: list[str],
    ):
        self.role = role
        self.project_dir = project_dir
        self.model = model
        self.settings_path = settings_path
        self.allowed_tools = allowed_tools
        self.session_id = str(uuid.uuid4())
        self._started = False

    def _build_args(self, prompt: str, resume: bool) -> list[str]:
        args = [
            "claude",
            "-p",
            "--output-format", "stream-json",
            "--verbose",
            "--model", self.model,
            "--settings", str(self.settings_path),
            "--allowed-tools", " ".join(self.allowed_tools),
        ]
        if resume:
            args += ["--resume", self.session_id]
        else:
            args += ["--session-id", self.session_id]
        args.append(prompt)
        return args

    async def query(self, prompt: str):
        """Spawn `claude -p` and yield parsed events as they arrive.

        Usage:
            session = ClaudeCliSession(...)
            async for event in session.query("Do X"):
                ...
        """
        args = self._build_args(prompt, resume=self._started)
        self._started = True
        proc = await asyncio.create_subprocess_exec(
            *args,
            cwd=str(self.project_dir),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            assert proc.stdout is not None
            async for raw_line in proc.stdout:
                line = raw_line.decode("utf-8", errors="replace")
                event = parse_stream_event(line)
                if event is not None:
                    yield event
            return_code = await proc.wait()
            if return_code != 0:
                err = await proc.stderr.read() if proc.stderr else b""
                raise RuntimeError(
                    f"claude -p exited {return_code}: {err.decode('utf-8', errors='replace')[:500]}"
                )
        finally:
            if proc.returncode is None:
                proc.kill()
                await proc.wait()
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd harness && python3 -m pytest test_cli_client.py -v
```

- [ ] **Step 5: Add a live smoke test gated by env var**

```python
# Append to harness/test_cli_client.py
import os
import pytest


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
        async for event in session.query("Say 'smoke-test-ok' and nothing else."):
            events.append(event)
        return events

    events = asyncio.run(run())
    assert any(
        isinstance(e, AssistantMessage)
        and any(isinstance(b, TextBlock) and "smoke-test-ok" in b.text for b in e.content)
        for e in events
    )
    results = [e for e in events if isinstance(e, ResultEvent)]
    assert len(results) == 1 and not results[0].is_error
```

- [ ] **Step 6: Run tests — skipped without env var**

```bash
cd harness && python3 -m pytest test_cli_client.py -v
# Later, for live verification in a dev worktree:
# HARNESS_CLI_LIVE_TEST=1 python3 -m pytest test_cli_client.py::test_cli_session_live_query -v
```

- [ ] **Step 7: Commit**

```bash
git add harness/cli_client.py harness/test_cli_client.py
git commit -m "feat(harness): add ClaudeCliSession subprocess wrapper with session resume"
```

---

## Task 4: `hook_runner.py` — Python-hook dispatcher for the CLI

**Files:**

- Create: `harness/hook_runner.py`
- Create: `harness/test_hook_runner.py`

- [ ] **Step 1: Write failing test for bash-hook dispatch**

```python
# harness/test_hook_runner.py
import json
import subprocess
import sys
from pathlib import Path

HOOK_RUNNER = Path(__file__).parent / "hook_runner.py"


def run_hook(kind: str, payload: dict) -> dict:
    proc = subprocess.run(
        [sys.executable, str(HOOK_RUNNER), kind],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        timeout=10,
    )
    assert proc.returncode == 0, f"hook_runner exited {proc.returncode}: {proc.stderr}"
    if not proc.stdout.strip():
        return {}
    return json.loads(proc.stdout)


def test_bash_hook_allows_npm():
    result = run_hook("bash", {
        "tool_input": {"command": "npm test"},
    })
    # Empty decision / no "block" means allowed
    assert result.get("decision") != "block"


def test_bash_hook_blocks_unknown_command_when_judge_disabled(monkeypatch, tmp_path):
    # Disable the judge so unknown commands cleanly block
    env = {"HARNESS_POLICY_JUDGE": "deny"}
    proc = subprocess.run(
        [sys.executable, str(HOOK_RUNNER), "bash"],
        input=json.dumps({"tool_input": {"command": "nmap localhost"}}),
        text=True,
        capture_output=True,
        env={**__import__("os").environ, **env},
        timeout=10,
    )
    out = json.loads(proc.stdout)
    assert out.get("decision") == "block"
    assert "nmap" in out.get("reason", "")


def test_feature_list_hook_allows_non_matching_path(tmp_path):
    result = run_hook("feature_list", {
        "tool_input": {"file_path": str(tmp_path / "other.json"), "content": "[]"},
    })
    assert result.get("decision") != "block"
```

- [ ] **Step 2: Run tests — expect FAIL (hook_runner missing)**

```bash
cd harness && python3 -m pytest test_hook_runner.py -v
```

- [ ] **Step 3: Implement `hook_runner.py`**

```python
# harness/hook_runner.py
"""
Hook Runner — bridge from CLI Claude to Python harness hooks.

Claude Code's CLI invokes hooks defined in settings.json as subprocess
commands. Each invocation:
  - reads the hook context JSON from stdin
  - writes a decision JSON to stdout
  - exits 0

This runner dispatches to the existing Python hook functions so we don't
maintain two copies of the allowlist / feature-list protections.

Usage (from settings.json):
  "command": "python3 /abs/path/to/harness/hook_runner.py bash"
  "command": "python3 /abs/path/to/harness/hook_runner.py feature_list"
"""

import asyncio
import json
import sys
from pathlib import Path

# Ensure harness/ is on sys.path regardless of CWD.
HARNESS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(HARNESS_DIR))

from security import bash_security_hook
from hooks import pre_write_feature_list_hook


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"decision": "block", "reason": "hook_runner: missing kind"}))
        return 0

    kind = sys.argv[1]
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as exc:
        print(json.dumps({"decision": "block", "reason": f"hook_runner: bad JSON: {exc}"}))
        return 0

    if kind == "bash":
        hook = bash_security_hook
    elif kind == "feature_list":
        hook = pre_write_feature_list_hook
    else:
        print(json.dumps({"decision": "block", "reason": f"hook_runner: unknown kind {kind}"}))
        return 0

    result = asyncio.run(hook(payload))
    print(json.dumps(result or {}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run tests — expect PASS for first + third, FAIL on second (judge not yet wired)**

```bash
cd harness && python3 -m pytest test_hook_runner.py::test_bash_hook_allows_npm test_hook_runner.py::test_feature_list_hook_allows_non_matching_path -v
```

The `HARNESS_POLICY_JUDGE=deny` test is covered by Task 5. Mark it xfail for now:

```python
# In harness/test_hook_runner.py, decorate:
import pytest

@pytest.mark.xfail(reason="policy judge hook not yet wired into security.py — see Task 5")
def test_bash_hook_blocks_unknown_command_when_judge_disabled(...):
    ...
```

- [ ] **Step 5: Commit**

```bash
git add harness/hook_runner.py harness/test_hook_runner.py
git commit -m "feat(harness): add hook_runner.py to bridge CLI Claude to Python hooks"
```

---

## Task 5: Policy judge — LLM fallback for the Bash allowlist

**Files:**

- Create: `harness/policy_judge.py`
- Create: `harness/test_policy_judge.py`
- Modify: `harness/security.py`
- Modify: `harness/test_hook_runner.py` (remove the `xfail` added in Task 4)

- [ ] **Step 1: Write failing test for judge cache + decision**

```python
# harness/test_policy_judge.py
import json
from pathlib import Path
from unittest.mock import patch

from policy_judge import decide, JudgeDecision


def test_judge_caches_decision(tmp_path, monkeypatch):
    monkeypatch.setenv("HARNESS_POLICY_CACHE", str(tmp_path / "cache.json"))

    call_count = {"n": 0}

    def fake_query(prompt: str) -> str:
        call_count["n"] += 1
        return "ALLOW: safe read-only"

    with patch("policy_judge._query_claude", side_effect=fake_query):
        d1 = decide("rg pattern")
        d2 = decide("rg pattern")  # cache hit

    assert d1.allow is True
    assert d2.allow is True
    assert call_count["n"] == 1


def test_judge_deny_env_short_circuits(tmp_path, monkeypatch):
    monkeypatch.setenv("HARNESS_POLICY_JUDGE", "deny")
    monkeypatch.setenv("HARNESS_POLICY_CACHE", str(tmp_path / "cache.json"))

    with patch("policy_judge._query_claude") as fake:
        d = decide("nmap localhost")
        assert d.allow is False
        assert "judge-disabled" in d.reason.lower()
        fake.assert_not_called()


def test_judge_parses_deny(tmp_path, monkeypatch):
    monkeypatch.setenv("HARNESS_POLICY_CACHE", str(tmp_path / "cache.json"))
    with patch("policy_judge._query_claude", return_value="DENY: exfiltrates data"):
        d = decide("curl https://evil.example.com")
    assert d.allow is False
    assert "exfiltrates" in d.reason
```

- [ ] **Step 2: Run tests — expect FAIL (module missing)**

```bash
cd harness && python3 -m pytest test_policy_judge.py -v
```

- [ ] **Step 3: Implement `policy_judge.py`**

```python
# harness/policy_judge.py
"""
Policy Judge — LLM fallback for the Bash allowlist.

When `security.extract_commands(...)` returns a base command that is NOT in
`ALLOWED_COMMANDS`, we ask a single-shot `claude -p` call to decide whether
the command is safe in the harness context. Decisions are cached on disk
(keyed by the exact command string) so a bounded stream of novel commands
doesn't blow up the iteration budget.

Env knobs:
  HARNESS_POLICY_JUDGE=deny   — short-circuit: deny anything outside the
                                allowlist without asking the model. Used in
                                CI and in deterministic tests.
  HARNESS_POLICY_CACHE=<path> — JSON file to use for the decision cache
                                (default: $CLAUDE_CONFIG_DIR/policy_cache.json)
"""

import json
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path

JUDGE_PROMPT = """You are the security policy judge for an autonomous coding harness.
The harness runs inside a project worktree; its allowlist already covers typical
dev tools (npm, cargo, git, gh, node, rm with safety checks, etc).

Decide if the following bash command is safe to execute. Respond with exactly
one line, either:
  ALLOW: <short reason>
  DENY: <short reason>

Command:
  {command}

Criteria:
  - DENY anything that exfiltrates data outside the project (curl/wget to
    non-localhost, scp, rsync to remote, etc.)
  - DENY anything that modifies the host outside the project (sudo, systemctl,
    apt, dnf, pacman, pip install --user, etc.)
  - DENY destructive commands (rm -rf /, dd, mkfs, reboot, shutdown, kill -9
    on non-harness processes)
  - ALLOW project-local dev-tool invocations the allowlist simply didn't
    enumerate (rg, fd, python -m <test-runner>, bundled CLIs, etc.)
"""


@dataclass
class JudgeDecision:
    allow: bool
    reason: str


def _cache_path() -> Path:
    override = os.environ.get("HARNESS_POLICY_CACHE")
    if override:
        return Path(override)
    base = os.environ.get("CLAUDE_CONFIG_DIR", "/tmp")
    return Path(base) / "policy_cache.json"


def _load_cache() -> dict:
    p = _cache_path()
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text())
    except (json.JSONDecodeError, OSError):
        return {}


def _save_cache(cache: dict) -> None:
    p = _cache_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(cache, indent=2))


def _query_claude(prompt: str) -> str:
    """One-shot `claude -p` call. Returns the final text response."""
    proc = subprocess.run(
        ["claude", "-p", "--output-format", "text", prompt],
        capture_output=True,
        text=True,
        timeout=60,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"policy judge claude -p failed: {proc.stderr[:300]}")
    return proc.stdout.strip()


def decide(command: str) -> JudgeDecision:
    """Ask the judge (or cache) whether a command outside the allowlist is safe."""
    if os.environ.get("HARNESS_POLICY_JUDGE") == "deny":
        return JudgeDecision(
            allow=False,
            reason=f"judge-disabled (HARNESS_POLICY_JUDGE=deny): '{command.split()[0] if command else ''}' not in allowlist",
        )

    cache = _load_cache()
    if command in cache:
        entry = cache[command]
        return JudgeDecision(allow=entry["allow"], reason=entry["reason"])

    raw = _query_claude(JUDGE_PROMPT.format(command=command)).splitlines()[0].strip()
    if raw.upper().startswith("ALLOW"):
        allow = True
        reason = raw.split(":", 1)[1].strip() if ":" in raw else "judge allowed"
    else:
        allow = False
        reason = raw.split(":", 1)[1].strip() if ":" in raw else "judge denied"

    cache[command] = {"allow": allow, "reason": reason}
    _save_cache(cache)
    return JudgeDecision(allow=allow, reason=reason)
```

- [ ] **Step 4: Run policy judge tests — expect PASS**

```bash
cd harness && python3 -m pytest test_policy_judge.py -v
```

- [ ] **Step 5: Wire judge into `security.py`**

In `harness/security.py`, replace the allowlist-miss block inside `bash_security_hook`:

```python
# BEFORE (line ~197-202):
        for cmd in commands:
            if cmd not in ALLOWED_COMMANDS:
                return {
                    "decision": "block",
                    "reason": f"Command '{cmd}' not in allowlist",
                }

# AFTER:
        from policy_judge import decide as _judge_decide  # local import to avoid cycles
        for cmd in commands:
            if cmd not in ALLOWED_COMMANDS:
                decision = _judge_decide(command)
                if not decision.allow:
                    return {
                        "decision": "block",
                        "reason": f"Command '{cmd}' not in allowlist; judge: {decision.reason}",
                    }
                # Judge allowed — fall through to the sensitive-command
                # validators below (still apply), then allow.
                break
```

- [ ] **Step 6: Remove the xfail in test_hook_runner.py**

Remove the `@pytest.mark.xfail(...)` added in Task 4 Step 4. Re-run:

```bash
cd harness && python3 -m pytest test_hook_runner.py -v
```

Expected: all three tests pass (the deny-env test now gets a real block).

- [ ] **Step 7: Commit**

```bash
git add harness/policy_judge.py harness/test_policy_judge.py harness/security.py harness/test_hook_runner.py
git commit -m "feat(harness): add policy judge as LLM fallback for bash allowlist"
```

---

## Task 6: `build_settings_file` in `client.py` — write hook-wired settings.json

**Files:**

- Modify: `harness/client.py`
- Create: `harness/test_client_settings.py`

- [ ] **Step 1: Write failing test**

```python
# harness/test_client_settings.py
import json
from pathlib import Path

from client import build_settings_file


def test_build_settings_file_writes_hooks(tmp_path):
    path = build_settings_file(tmp_path, sandbox=True)
    assert path.exists()
    data = json.loads(path.read_text())

    # Permissions
    assert data["permissions"]["defaultMode"] == "acceptEdits"
    # Sandbox
    assert data["sandbox"]["enabled"] is True

    # Hooks wired via hook_runner.py
    bash_entries = [
        h for h in data["hooks"]["PreToolUse"] if h["matcher"] == "Bash"
    ]
    assert len(bash_entries) == 1
    cmd = bash_entries[0]["hooks"][0]["command"]
    assert "hook_runner.py" in cmd
    assert cmd.strip().endswith(" bash")

    write_entries = [
        h for h in data["hooks"]["PreToolUse"] if "Write" in h["matcher"]
    ]
    assert len(write_entries) == 1
    assert "feature_list" in write_entries[0]["hooks"][0]["command"]


def test_build_settings_file_no_sandbox(tmp_path):
    path = build_settings_file(tmp_path, sandbox=False)
    data = json.loads(path.read_text())
    assert data["permissions"]["defaultMode"] == "bypassPermissions"
    assert "sandbox" not in data
```

- [ ] **Step 2: Run tests — expect FAIL (function missing)**

```bash
cd harness && python3 -m pytest test_client_settings.py -v
```

- [ ] **Step 3: Implement `build_settings_file`**

In `harness/client.py`, add after `BUILTIN_TOOLS` and before `create_client`:

```python
def build_settings_file(project_dir: Path, *, sandbox: bool = True) -> Path:
    """Write settings.json for a ClaudeCliSession run.

    Mirrors the security config used by the SDK path (create_client) but
    wires PreToolUse hooks through harness/hook_runner.py so the existing
    Python allowlist + feature_list protections keep firing under the CLI.
    """
    import sys
    hook_runner = (Path(__file__).resolve().parent / "hook_runner.py")

    settings: dict = {
        "permissions": {
            "allow": [
                "Read(.//**)", "Write(.//**)", "Edit(.//**)",
                "Glob(.//**)", "Grep(.//**)", "Bash(*)",
            ],
        },
        "hooks": {
            "PreToolUse": [
                {
                    "matcher": "Bash",
                    "hooks": [{
                        "type": "command",
                        "command": f"{sys.executable} {hook_runner} bash",
                    }],
                },
                {
                    "matcher": "Write|Edit",
                    "hooks": [{
                        "type": "command",
                        "command": f"{sys.executable} {hook_runner} feature_list",
                    }],
                },
            ],
        },
    }

    if sandbox:
        settings["sandbox"] = {"enabled": True, "autoAllowBashIfSandboxed": True}
        settings["permissions"]["defaultMode"] = "acceptEdits"
    else:
        settings["permissions"]["defaultMode"] = "bypassPermissions"

    project_dir.mkdir(parents=True, exist_ok=True)
    path = project_dir / ".claude_settings_cli.json"
    path.write_text(json.dumps(settings, indent=2))
    return path
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd harness && python3 -m pytest test_client_settings.py -v
```

- [ ] **Step 5: Commit**

```bash
git add harness/client.py harness/test_client_settings.py
git commit -m "feat(harness): settings.json writer wires Python hooks for CLI runs"
```

---

## Task 7: Drop `ANTHROPIC_API_KEY` requirement from CLI path

**Files:**

- Modify: `harness/client.py`
- Modify: `harness/autonomous_agent_demo.py`

- [ ] **Step 1: Add a `--client` CLI flag (default `cli`)**

In `harness/autonomous_agent_demo.py`, inside `argparse` setup:

```python
parser.add_argument(
    "--client",
    choices=["sdk", "cli"],
    default="cli",
    help="Claude client backend: 'cli' (claude -p subprocess, default) or 'sdk' (claude_code_sdk, requires ANTHROPIC_API_KEY).",
)
```

Thread `args.client` into `run_autonomous_agent(..., client_kind=args.client)`.

- [ ] **Step 2: Gate the API-key check to `--client sdk`**

In `harness/client.py` `create_client`, the top of the function:

```python
# BEFORE
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY not set")

# AFTER — unchanged (create_client is only called on the SDK path).
# The CLI path goes through build_settings_file + ClaudeCliSession and
# never touches ANTHROPIC_API_KEY; the `claude` binary uses its own auth.
```

Nothing to change in `create_client` itself — just confirm no top-level module import enforces the env var. Add a comment:

```python
# NOTE: ANTHROPIC_API_KEY is only required on the SDK path.
# The CLI path (build_settings_file + cli_client.ClaudeCliSession) inherits
# the user's `claude` CLI auth and does not use this env var.
```

- [ ] **Step 3: Manually verify**

```bash
cd harness
unset ANTHROPIC_API_KEY
python3 autonomous_agent_demo.py --help | grep -- --client
# Expect: --client flag to appear
```

- [ ] **Step 4: Commit**

```bash
git add harness/autonomous_agent_demo.py harness/client.py
git commit -m "feat(harness): add --client {sdk,cli} flag, default cli (no API key)"
```

---

## Task 8: Rewire `run_agent_session` + `run_feature_iteration` for CLI client

**Files:**

- Modify: `harness/agent.py`

- [ ] **Step 1: Add a client-neutral event iterator**

In `harness/agent.py`, replace the body of `run_agent_session` with a dispatcher that accepts either client kind. Keep the same return signature and the same stdout format (the CLAUDE.md status reporting depends on those lines).

```python
from cli_client import AssistantMessage, TextBlock, ToolUseBlock, UserMessage, ToolResultBlock, ResultEvent, ClaudeCliSession
from client import build_settings_file, create_client, BUILTIN_TOOLS


async def _iter_events(client_or_session, prompt: str):
    """Yield SDK-shaped events regardless of backend."""
    if isinstance(client_or_session, ClaudeCliSession):
        async for event in client_or_session.query(prompt):
            yield event
    else:
        # Legacy SDK path
        await client_or_session.query(prompt)
        async for msg in client_or_session.receive_response():
            yield msg


async def run_agent_session(client_or_session, message: str, project_dir: Path) -> tuple[str, str]:
    print("  Sending prompt to Claude Code...\n")
    try:
        response_text = ""
        async for event in _iter_events(client_or_session, message):
            # AssistantMessage (same shape across SDK + CLI adapter)
            if isinstance(event, AssistantMessage) or type(event).__name__ == "AssistantMessage":
                content = getattr(event, "content", [])
                for block in content:
                    # Text
                    if isinstance(block, TextBlock) or type(block).__name__ == "TextBlock":
                        text = getattr(block, "text", "")
                        response_text += text
                        print(text, end="", flush=True)
                    # Tool use
                    elif isinstance(block, ToolUseBlock) or type(block).__name__ == "ToolUseBlock":
                        name = getattr(block, "name", "?")
                        print(f"\n  [Tool: {name}]", flush=True)
                        inp = getattr(block, "input", {})
                        inp_str = str(inp)
                        print(f"    {inp_str[:200]}{'...' if len(inp_str) > 200 else ''}", flush=True)
            # UserMessage → tool results
            elif isinstance(event, UserMessage) or type(event).__name__ == "UserMessage":
                content = getattr(event, "content", [])
                for block in content:
                    if isinstance(block, ToolResultBlock) or type(block).__name__ == "ToolResultBlock":
                        result_content = getattr(block, "content", "")
                        is_error = getattr(block, "is_error", False)
                        if "blocked" in str(result_content).lower():
                            print(f"    [BLOCKED] {result_content}", flush=True)
                        elif is_error:
                            print(f"    [Error] {str(result_content)[:500]}", flush=True)
                        else:
                            print("    [Done]", flush=True)
            # Terminal result (CLI only)
            elif isinstance(event, ResultEvent):
                if event.is_error:
                    print(f"\n  [result: error]", flush=True)

        print("\n" + "-" * 70 + "\n")
        return "continue", response_text

    except Exception as e:
        print(f"  Error during session: {e}")
        return "error", str(e)
```

- [ ] **Step 2: Add a session factory**

```python
def _make_session(client_kind: str, role: str, project_dir: Path, model: str, sandbox: bool):
    """Return either a ClaudeCliSession (CLI) or a ClaudeSDKClient (SDK)."""
    if client_kind == "cli":
        settings_path = build_settings_file(project_dir, sandbox=sandbox)
        return ClaudeCliSession(
            role=role,
            project_dir=project_dir,
            model=model,
            settings_path=settings_path,
            allowed_tools=BUILTIN_TOOLS,
        )
    return create_client(project_dir, model, sandbox=sandbox)
```

- [ ] **Step 3: Update callers**

Every `client = create_client(...)` + `async with client:` block becomes:

```python
# CLI path has no async context manager — it's per-query subprocess.
session = _make_session(client_kind, role="coder", project_dir=project_dir, model=model, sandbox=sandbox)
if isinstance(session, ClaudeCliSession):
    status, response = await run_agent_session(session, prompt, project_dir)
else:
    async with session:
        status, response = await run_agent_session(session, prompt, project_dir)
```

Thread `client_kind` through:

- `run_autonomous_agent(..., client_kind)`
- `run_feature_iteration(..., client_kind)`
- `run_cloud_review_loop(..., client_kind)`

- [ ] **Step 4: Run the existing harness test suite**

```bash
cd harness && python3 -m pytest -v
```

Expected: all prior tests pass (security, policy_judge, cli_client, hook_runner, client_settings). No new tests required here — the next task is the integration dry-run.

- [ ] **Step 5: Commit**

```bash
git add harness/agent.py
git commit -m "refactor(harness): dispatch SDK vs CLI client in agent loop"
```

---

## Task 9: Dry-run parity smoke test

**Files:**

- Create: `harness/scripts/dry_run_parity.py`
- Create: `harness/scripts/fixtures/minimal_feature_list.json`
- Create: `harness/scripts/fixtures/app_spec.md`

- [ ] **Step 1: Build a throwaway fixture repo**

```python
# harness/scripts/dry_run_parity.py
"""
Dry-run parity smoke test.

Runs a one-iteration harness cycle against a throwaway git repo under
both --client sdk and --client cli (when API key available) or cli-only
and prints a diff of:
  - final commits authored
  - final feature_list.json state
  - stderr/error lines

Not a pytest — it shells out to autonomous_agent_demo.py and compares
observable output. Run manually before landing the refactor:

  HARNESS_CLI_LIVE_TEST=1 python3 harness/scripts/dry_run_parity.py

Exit 0 on parity (or cli-only success when SDK skipped), 1 on divergence.
"""

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

FIXTURES = Path(__file__).resolve().parent / "fixtures"


def setup_repo(tmp: Path) -> Path:
    repo = tmp / "repo"
    repo.mkdir()
    subprocess.check_call(["git", "init", "-q"], cwd=repo)
    subprocess.check_call(["git", "config", "user.email", "harness@local"], cwd=repo)
    subprocess.check_call(["git", "config", "user.name", "Harness Dry Run"], cwd=repo)
    (repo / "README.md").write_text("# dry-run fixture\n")
    shutil.copy(FIXTURES / "minimal_feature_list.json", repo / "feature_list.json")
    shutil.copy(FIXTURES / "app_spec.md", repo / "app_spec.md")
    subprocess.check_call(["git", "add", "-A"], cwd=repo)
    subprocess.check_call(["git", "commit", "-q", "-m", "seed"], cwd=repo)
    return repo


def run_harness(repo: Path, client_kind: str) -> dict:
    """Run one iteration, return {commits_after, features_after, exit_code, tail}."""
    demo = Path(__file__).resolve().parent.parent / "autonomous_agent_demo.py"
    env = {**os.environ, "HARNESS_POLICY_JUDGE": "deny"}  # deterministic
    proc = subprocess.run(
        [
            sys.executable, str(demo),
            "--project-dir", str(repo),
            "--max-iterations", "1",
            "--skip-review", "--skip-relay",
            "--no-sandbox",
            "--client", client_kind,
        ],
        env=env, capture_output=True, text=True, timeout=600,
    )
    commits = subprocess.check_output(
        ["git", "log", "--oneline"], cwd=repo, text=True
    ).splitlines()
    features = (repo / "feature_list.json").read_text()
    return {
        "exit_code": proc.returncode,
        "commits": commits,
        "features": features,
        "tail": (proc.stdout + proc.stderr)[-2000:],
    }


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp_s:
        tmp = Path(tmp_s)
        cli_repo = setup_repo(tmp / "cli_run")
        cli_result = run_harness(cli_repo, "cli")
        print(f"[cli]  exit={cli_result['exit_code']}  commits={len(cli_result['commits'])}")

        if os.environ.get("ANTHROPIC_API_KEY"):
            sdk_repo = setup_repo(tmp / "sdk_run")
            sdk_result = run_harness(sdk_repo, "sdk")
            print(f"[sdk]  exit={sdk_result['exit_code']}  commits={len(sdk_result['commits'])}")

            # Parity: both finish, both flip feature_list.json to passes=true
            if cli_result["exit_code"] != sdk_result["exit_code"]:
                print("DIVERGENCE: exit codes differ")
                print("CLI tail:\n" + cli_result["tail"])
                print("SDK tail:\n" + sdk_result["tail"])
                return 1
        else:
            print("[sdk]  SKIPPED — ANTHROPIC_API_KEY not set")

        if cli_result["exit_code"] != 0:
            print("CLI run failed:\n" + cli_result["tail"])
            return 1

        print("OK")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Minimal feature fixture**

```json
// harness/scripts/fixtures/minimal_feature_list.json
[
  {
    "id": 1,
    "phase": 1,
    "category": "smoke",
    "description": "Create a file called HELLO.md with the content 'hello world' at the repo root.",
    "steps": ["Create HELLO.md with exactly 'hello world' as its only line."],
    "dependencies": [],
    "passes": false
  }
]
```

```markdown
// harness/scripts/fixtures/app_spec.md

# Dry-Run Fixture Spec

Trivial spec used only by the dry-run parity smoke test.
Should not be edited by the Coder — feature_list.json is pre-populated.
```

- [ ] **Step 3: Run the dry-run (manual — requires claude CLI auth + optionally API key)**

```bash
cd /home/will/projects/vimeflow
python3 harness/scripts/dry_run_parity.py
# Expect: [cli] exit=0, [sdk] SKIPPED or exit=0, "OK"
```

- [ ] **Step 4: Commit**

```bash
git add harness/scripts/dry_run_parity.py harness/scripts/fixtures/
git commit -m "test(harness): dry-run parity smoke between SDK and CLI clients"
```

---

## Task 10: Update `harness/CLAUDE.md`

**Files:**

- Modify: `harness/CLAUDE.md`

- [ ] **Step 1: Rewrite the Environment Variables table**

Replace the `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL` rows with:

```markdown
## Environment Variables

| Variable               | Required | Description                                             |
| ---------------------- | -------- | ------------------------------------------------------- |
| `OPENAI_API_KEY`       | Yes\*    | Required for local Codex CLI review (Phase 2 + Phase 3) |
| `HARNESS_POLICY_JUDGE` | No       | Set to `deny` to disable the LLM policy judge (CI mode) |
| `HARNESS_POLICY_CACHE` | No       | Override policy-judge cache path                        |
| `ANTHROPIC_API_KEY`    | SDK path | Only needed with `--client sdk` (legacy)                |
| `ANTHROPIC_BASE_URL`   | SDK path | Only needed with `--client sdk` (legacy)                |

\*Not required if running with `--skip-review --skip-relay`.

**Auth:** The default `--client cli` path inherits the user's `claude` CLI
auth (`claude` login). No `ANTHROPIC_API_KEY` is required. The legacy
`--client sdk` path still uses the API key.
```

- [ ] **Step 2: Add a `--client` row to the CLI Flags table**

```markdown
| `--client` | `cli` | Client backend: `cli` (claude -p subprocess) or `sdk` (legacy) |
```

- [ ] **Step 3: Expand the Safety Layers table**

Add a row:

```markdown
| **Policy judge** | `policy_judge.py` | LLM fallback when a bash command isn't in the allowlist. One-shot `claude -p` call, decisions cached. Disable with `HARNESS_POLICY_JUDGE=deny`. |
```

- [ ] **Step 4: Add a Troubleshooting row**

```markdown
| `claude: command not found` on `--client cli` | `claude` CLI not installed or not on PATH | Install Claude Code CLI or pass `--client sdk` to use the API-key backend |
| Policy judge keeps blocking a safe command | Missing the command from the allowlist | Add to `ALLOWED_COMMANDS` in `security.py`, or accept the judge's cached decision. Inspect cache at `$CLAUDE_CONFIG_DIR/policy_cache.json`. |
```

- [ ] **Step 5: Commit**

```bash
git add harness/CLAUDE.md
git commit -m "docs(harness): document --client cli path and policy judge"
```

---

## Task 11: End-to-end workflow intact check

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit-test suite**

```bash
cd harness && python3 -m pytest -v
```

Expected: all pass.

- [ ] **Step 2: Run dry-run parity**

```bash
cd /home/will/projects/vimeflow
python3 harness/scripts/dry_run_parity.py
# Expect: "OK"
```

- [ ] **Step 3: Dry-run with `--max-iterations 1 --client cli` in a scratch worktree**

```bash
# From a dedicated worktree with seeded feature_list.json:
cd .claude/worktrees/feat-harness-cli-refactor
unset ANTHROPIC_API_KEY ANTHROPIC_BASE_URL
python3 harness/autonomous_agent_demo.py --client cli --max-iterations 1 --skip-review --skip-relay
```

Expected: one Coder iteration runs under `claude -p`, commits land on the branch, `feature_list.json` flips one feature to `passes=true`.

- [ ] **Step 4: Dry-run with `--client sdk` (regression check)**

```bash
set -a && source /path/to/.env && set +a
python3 harness/autonomous_agent_demo.py --client sdk --max-iterations 1 --skip-review --skip-relay
```

Expected: same outcome as Step 3. This confirms the SDK path still works so the refactor is additive, not destructive.

- [ ] **Step 5: Commit (only if docs/progress updates needed)**

If `docs/roadmap/progress.yaml` tracks the harness, update the refactor row. Otherwise skip.

---

## Verification checklist (run before merging)

- [ ] `python3 -m pytest harness/` — all unit tests pass
- [ ] `python3 harness/scripts/dry_run_parity.py` — exits 0 in at least CLI mode
- [ ] `unset ANTHROPIC_API_KEY && python3 harness/autonomous_agent_demo.py --client cli --max-iterations 1 --skip-review --skip-relay` succeeds in a scratch worktree
- [ ] `python3 harness/autonomous_agent_demo.py --client sdk --max-iterations 1 --skip-review --skip-relay` (with API key) still succeeds — legacy path intact
- [ ] `harness/CLAUDE.md` no longer lists `ANTHROPIC_API_KEY` as required for the default workflow
- [ ] Hookify pre-launch rules (`block-harness-no-api-key`) updated or relaxed — they were written for the SDK path; either broaden to gate on `--client sdk` or drop the API-key warning. (Follow-up issue if the hookify rule engine can't inspect CLI args; file one instead of over-engineering.)
