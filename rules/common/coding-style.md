# Coding Style

> For the design judgment behind these rules, read
> [design-philosophy.md](./design-philosophy.md). Checklists are guardrails; the
> goal is lower cognitive load.

## Immutability (CRITICAL)

ALWAYS create new objects, NEVER mutate existing ones:

```
// Pseudocode
WRONG:  modify(original, field, value) → changes original in-place
CORRECT: update(original, field, value) → returns new copy with change
```

Rationale: Immutable data prevents hidden side effects, makes debugging easier, and enables safe concurrency.

## File Organization and Deep Modules

Prefer cohesive files and deep modules over shallow fragmentation:

- High cohesion, low coupling
- 200-400 lines typical, 800 max as a review trigger, not an automatic split
- Extract utilities when they hide meaningful complexity or remove real duplication
- Organize by feature/domain, not by type
- Keep interfaces small enough that callers do not need to understand internals
- Avoid pass-through files or wrappers that add navigation without hiding complexity

Rationale: many small files help only when each file owns a coherent concept.
A deep module with a simple interface can be easier to understand than several
tiny modules that force readers to chase control flow across the codebase.

## Error Handling

ALWAYS handle errors comprehensively:

- Prefer designing errors out of existence with validation, types, schemas, and
  safer APIs
- Handle remaining errors at the level with enough context to recover or explain
  them
- Provide user-friendly error messages in UI-facing code
- Log detailed error context on the server side
- Never silently swallow errors

Do not discard exceptions, rejected promises, failed command exits, or invalid
response envelopes. Either recover and leave state consistent, translate the
failure into a domain error, or surface it clearly to the caller/user.

## Input Validation

ALWAYS validate at system boundaries:

- Validate all user input before processing
- Use schema-based validation where available
- Fail fast with clear error messages
- Never trust external data (API responses, user input, file content)

## Code Quality Checklist

Before marking work complete:

- [ ] Code is readable and well-named
- [ ] Functions are focused (<50 lines is a review trigger)
- [ ] Files are cohesive (<800 lines is a review trigger)
- [ ] Modules have small interfaces that hide meaningful complexity
- [ ] No deep nesting (>4 levels)
- [ ] Proper error handling
- [ ] No hardcoded values (use constants or config)
- [ ] No mutation (immutable patterns used)
