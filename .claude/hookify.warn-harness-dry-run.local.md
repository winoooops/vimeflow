---
name: warn-harness-dry-run
enabled: true
event: bash
conditions:
  - field: command
    operator: regex_match
    pattern: python3?\s+.*autonomous_agent_demo\.py
  - field: command
    operator: regex_match
    pattern: ^(?!.*--max-iterations\s+1(\s|$))
action: warn
---

**Warning: Consider a dry-run first.**

If this is the first harness run in this worktree, do a single-iteration dry-run to verify the environment before scaling up:

```bash
python autonomous_agent_demo.py --no-sandbox --max-iterations 1
```

This catches issues with missing API keys, broken hooks, or permission problems before they waste 10+ iterations.

After a successful dry-run, proceed with the full run. If you've already verified the environment, you can safely ignore this warning.
