#!/usr/bin/env python3
"""
Dry-run parity smoke test.

Runs a one-iteration harness cycle against a throwaway git repo under
--client cli (always) and --client sdk (when ANTHROPIC_API_KEY is set),
then prints a per-run summary:
  - autonomous_agent_demo.py exit code
  - git commits after the run
  - feature_list.json after the run
  - last 2 KB of combined stdout + stderr

Not a pytest — shells out to autonomous_agent_demo.py and compares
observable output. Run manually before landing the refactor:

  python3 harness/scripts/dry_run_parity.py

Exit 0 on parity (or CLI-only success when SDK is skipped), 1 on divergence.

Environment:
  HARNESS_POLICY_JUDGE=deny  — forced, for deterministic runs
  HARNESS_CLI_LIVE_TEST=1    — required to enable the CLI run (safety gate)
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
    subprocess.check_call(
        ["git", "config", "commit.gpgsign", "false"], cwd=repo
    )
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
            "`claude` / `claude_code_sdk` sessions against a scratch repo."
        )
        return 2

    with tempfile.TemporaryDirectory(prefix="harness-parity-") as tmp_s:
        tmp = Path(tmp_s)

        cli_repo = setup_repo(tmp / "cli_run")
        cli_result = run_harness(cli_repo, "cli")
        report("cli", cli_result)

        if os.environ.get("ANTHROPIC_API_KEY"):
            sdk_repo = setup_repo(tmp / "sdk_run")
            sdk_result = run_harness(sdk_repo, "sdk")
            report("sdk", sdk_result)

            if cli_result["exit_code"] != sdk_result["exit_code"]:
                print("DIVERGENCE: exit codes differ")
                return 1
        else:
            print("[sdk] SKIPPED — ANTHROPIC_API_KEY not set")

        if cli_result["exit_code"] != 0:
            print("CLI run failed")
            return 1

        print("OK")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
