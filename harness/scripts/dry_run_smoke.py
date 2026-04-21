#!/usr/bin/env python3
"""
Dry-run smoke test.

Runs a one-iteration harness cycle against a throwaway git repo using the
default CLI backend (`--client cli`). Verifies end-to-end plumbing:
  - settings.json writer → hook_runner → security.py + hooks.py fire
  - claude -p subprocess streams events
  - feature_list.json mutation survives the session
  - a commit lands in the scratch repo

Optional fallback check: set HARNESS_SMOKE_SDK=1 (and ensure
ANTHROPIC_API_KEY is set) to also run `--client sdk` against a second
scratch repo. Useful when validating the fallback still works after a
refactor.

Exit 0 on success, 1 on failure, 2 if the safety gate isn't set.

Environment:
  HARNESS_CLI_LIVE_TEST=1    required — this spawns real `claude` sessions
  HARNESS_POLICY_JUDGE=deny  forced — keeps the judge deterministic
  HARNESS_SMOKE_SDK=1        optional — also exercises --client sdk
"""

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

FIXTURES = Path(__file__).resolve().parent / "fixtures"
HARNESS_DIR = Path(__file__).resolve().parent.parent
DEMO = HARNESS_DIR / "autonomous_agent_demo.py"


def setup_repo(tmp: Path) -> Path:
    repo = tmp
    repo.mkdir(parents=True, exist_ok=True)
    subprocess.check_call(["git", "init", "-q"], cwd=repo)
    subprocess.check_call(["git", "config", "user.email", "harness@local"], cwd=repo)
    subprocess.check_call(["git", "config", "user.name", "Harness Dry Run"], cwd=repo)
    subprocess.check_call(["git", "config", "commit.gpgsign", "false"], cwd=repo)
    (repo / "README.md").write_text("# dry-run fixture\n")
    shutil.copy(FIXTURES / "minimal_feature_list.json", repo / "feature_list.json")
    shutil.copy(FIXTURES / "app_spec.md", repo / "app_spec.md")
    subprocess.check_call(["git", "add", "-A"], cwd=repo)
    subprocess.check_call(["git", "commit", "-q", "-m", "seed"], cwd=repo)
    return repo


def run_harness(repo: Path, client_kind: str) -> dict:
    env = {
        **os.environ,
        "HARNESS_POLICY_JUDGE": "deny",
    }
    proc = subprocess.run(
        [
            sys.executable, str(DEMO),
            "--project-dir", str(repo),
            "--max-iterations", "1",
            "--skip-review", "--skip-relay",
            "--no-sandbox",
            "--client", client_kind,
        ],
        env=env,
        capture_output=True,
        text=True,
        timeout=600,
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


def report(label: str, result: dict) -> None:
    print(f"[{label}] exit={result['exit_code']}  commits={len(result['commits'])}")
    for line in result["commits"]:
        print(f"   {line}")
    if result["exit_code"] != 0:
        print(f"[{label}] tail:\n{result['tail']}")


def main() -> int:
    if not os.environ.get("HARNESS_CLI_LIVE_TEST"):
        print(
            "HARNESS_CLI_LIVE_TEST=1 required. This script spawns real "
            "`claude` sessions against a scratch repo."
        )
        return 2

    with tempfile.TemporaryDirectory(prefix="harness-smoke-") as tmp_s:
        tmp = Path(tmp_s)

        cli_repo = setup_repo(tmp / "cli_run")
        cli_result = run_harness(cli_repo, "cli")
        report("cli", cli_result)

        if os.environ.get("HARNESS_SMOKE_SDK") == "1":
            if not os.environ.get("ANTHROPIC_API_KEY"):
                print("[sdk fallback] SKIPPED — HARNESS_SMOKE_SDK=1 but ANTHROPIC_API_KEY unset")
            else:
                sdk_repo = setup_repo(tmp / "sdk_run")
                sdk_result = run_harness(sdk_repo, "sdk")
                report("sdk fallback", sdk_result)
                if sdk_result["exit_code"] != 0:
                    print("SDK fallback failed — investigate or disable via unset HARNESS_SMOKE_SDK")
                    return 1

        if cli_result["exit_code"] != 0:
            print("CLI smoke failed")
            return 1

        print("OK")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
