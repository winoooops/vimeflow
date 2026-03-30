# Agent Orchestration

## Available Agents

| Agent                | Purpose                 | When to Use                   |
| -------------------- | ----------------------- | ----------------------------- |
| architect            | System design           | Architectural decisions       |
| build-error-resolver | Fix build errors        | When build fails              |
| code-reviewer        | Code review             | After writing code            |
| doc-updater          | Documentation           | Updating docs                 |
| e2e-runner           | E2E testing             | Critical user flows           |
| planner              | Implementation planning | Complex features, refactoring |
| refactor-cleaner     | Dead code cleanup       | Code maintenance              |
| security-reviewer    | Security analysis       | Before commits                |
| tdd-guide            | Test-driven development | New features, bug fixes       |
| typescript-reviewer  | TypeScript code review  | After writing TypeScript code |

## Immediate Agent Usage

No user prompt needed:

1. Complex feature requests - Use **planner** agent
2. Code just written/modified - Use **code-reviewer** agent
3. Bug fix or new feature - Use **tdd-guide** agent
4. Architectural decision - Use **architect** agent

## Parallel Task Execution

ALWAYS use parallel Task execution for independent operations:

```markdown
# GOOD: Parallel execution

Launch 3 agents in parallel:

1. Agent 1: Security analysis of auth module
2. Agent 2: Performance review of cache system
3. Agent 3: Type checking of utilities

# BAD: Sequential when unnecessary

First agent 1, then agent 2, then agent 3
```

## Multi-Perspective Analysis

For complex problems, use split role sub-agents:

- Factual reviewer
- Senior engineer
- Security expert
- Consistency reviewer
- Redundancy checker
