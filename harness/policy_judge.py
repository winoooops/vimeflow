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
                                (default: $CLAUDE_CONFIG_DIR/policy_cache.json,
                                falling back to /tmp/harness_policy_cache.json)
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
    base = os.environ.get("CLAUDE_CONFIG_DIR")
    if base:
        return Path(base) / "policy_cache.json"
    return Path("/tmp/harness_policy_cache.json")


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
        ["claude", prompt, "-p", "--output-format", "text"],
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
        first = command.split()[0] if command.split() else ""
        return JudgeDecision(
            allow=False,
            reason=f"judge-disabled (HARNESS_POLICY_JUDGE=deny): '{first}' not in allowlist",
        )

    cache = _load_cache()
    if command in cache:
        entry = cache[command]
        return JudgeDecision(allow=entry["allow"], reason=entry["reason"])

    raw_lines = _query_claude(JUDGE_PROMPT.format(command=command)).splitlines()
    raw = raw_lines[0].strip() if raw_lines else ""
    if raw.upper().startswith("ALLOW"):
        allow = True
        reason = raw.split(":", 1)[1].strip() if ":" in raw else "judge allowed"
    else:
        allow = False
        reason = raw.split(":", 1)[1].strip() if ":" in raw else "judge denied"

    cache[command] = {"allow": allow, "reason": reason}
    _save_cache(cache)
    return JudgeDecision(allow=allow, reason=reason)
