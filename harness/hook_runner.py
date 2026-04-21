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

HARNESS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(HARNESS_DIR))

# Import-time fail-closed: if `security` or `hooks` fails to import
# (bad syntax after a patch, missing transitive dep, corrupted .pyc),
# main() would never run and Claude CLI — seeing no stdout — would
# default to ALLOW. Emit an explicit block and exit 0 so the CLI
# records the deny.
try:
    from security import bash_security_hook  # noqa: E402
    from hooks import pre_write_feature_list_hook  # noqa: E402
except Exception as _exc:  # noqa: BLE001 — last line of defense must be broad
    print(json.dumps({
        "decision": "block",
        "reason": f"hook_runner: import failed ({type(_exc).__name__}: {_exc})",
    }))
    sys.exit(0)


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

    # Fail CLOSED on any hook exception. Claude CLI defaults to allow
    # when a hook subprocess produces no decision JSON (see client.py), so
    # a raw crash here would silently bypass security. Catch everything,
    # emit an explicit block, and surface the error so operators see it.
    #
    # Outer timeout: Claude CLI can SIGKILL a slow hook subprocess before
    # the inner 60 s LLM-query deadline in policy_judge fires. A SIGKILL
    # can't be caught, so the hook emits nothing and the CLI falls back
    # to allow. Cap at 45 s (under the 60 s judge timeout) so we always
    # have time to emit an explicit block before the CLI gives up.
    try:
        result = asyncio.run(asyncio.wait_for(hook(payload), timeout=45.0))
        print(json.dumps(result or {}))
    except asyncio.TimeoutError:
        print(json.dumps({
            "decision": "block",
            "reason": f"hook_runner: {kind} hook exceeded 45s",
        }))
    except Exception as exc:  # noqa: BLE001 — last line of defense must be broad
        print(json.dumps({
            "decision": "block",
            "reason": f"hook_runner: {kind} hook raised {type(exc).__name__}: {exc}",
        }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
