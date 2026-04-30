# Design Philosophy

This rule captures the project-level takeaways from *A Philosophy of Software
Design* and turns them into reviewable engineering judgment. It explains why the
other rules exist, especially when a checklist is too blunt to make the right
call.

## Strategic Programming

Good design costs time. Spend that time deliberately before an implementation
hardens into an interface other agents must preserve.

- Think twice before adding a public API, IPC command, hook return value, event
  payload, shared type, or reusable component.
- Prefer a little design thought now over repeated tactical patches later.
- Make the next change easier, not only the current change possible.
- When a trade-off is not obvious, write down the why using the IDEA framework.

Tactical programming feels fast because it optimizes for the immediate patch.
Strategic programming is faster over the life of the codebase because it reduces
the amount future readers must hold in their heads.

Review question: does this change reduce future cognitive load, or does it pass
that load to the next caller, reviewer, or agent?

## Deep Modules

Prefer deep modules: simple interfaces that hide substantial, coherent
behavior. A deep module lowers cognitive load because callers can use it without
knowing its internal steps.

A module is deep when:

- Its public interface is small, stable, and intention-revealing.
- Its implementation absorbs meaningful complexity behind that interface.
- Callers do not need to sequence low-level steps manually.
- Callers do not need to know internal state transitions or recovery details.
- The module can change internally without forcing widespread caller changes.

A module is shallow when:

- It mostly forwards parameters to another function.
- Its name promises an abstraction but its callers still manage the hard parts.
- It exposes implementation details as flags, modes, or ordering rules.
- Splitting it into another file adds navigation without hiding complexity.

Small files are useful only when they preserve cohesion. Do not split a good
abstraction into pass-through pieces just to satisfy a size heuristic.

## Complexity Budget

Complexity is the enemy, not line count by itself. Size limits are warning signs
that invite design review; they are not automatic proof that code should be
split.

When evaluating complexity, ask:

- How much must a reader know to make a safe change here?
- Are concepts named clearly, or must the reader infer them from mechanics?
- Is state localized, or does understanding require chasing many files?
- Are dependencies one-directional and obvious?
- Is the code difficult because the problem is difficult, or because the design
  leaked too much of the problem to callers?

Prefer designs that reduce knowledge requirements at module boundaries.

## Error Design

The best error handling is often error prevention:

- Validate once at system boundaries.
- Make invalid states unrepresentable where practical.
- Use types, schemas, constructors, and safer helper APIs to prevent misuse.
- Narrow unknown external data before it enters application logic.
- Keep recovery logic inside the module that has enough context to recover.

When an error cannot be designed away, do not ignore it. Pick one explicit path:

- Recover locally and leave state consistent.
- Retry or mask the failure only when the module can prove that is safe.
- Translate the low-level failure into a meaningful domain error.
- Surface the error to a caller or user who can act on it.

Never silently swallow exceptions, rejected promises, failed command exits, or
invalid response envelopes. A swallowed error turns a local failure into global
confusion.

## Interface Discipline

Every interface is a cognitive load contract. Keep interfaces narrow and make
the hard guarantees clear.

- Export fewer things, with stronger meanings.
- Prefer one complete operation over several half-operations callers must order.
- Avoid boolean flags that make callers understand hidden modes.
- Return domain-shaped results instead of leaking transport or library details.
- Document invariants when the type system cannot express them.

An interface is successful when a caller can use it correctly without reading
the implementation.

## Review Heuristics

Flag design issues when the diff introduces:

- A shallow wrapper that adds a file or function but hides no complexity.
- A public API that exposes internal sequencing, retries, validation, or cleanup.
- A tactical patch that solves one case by adding hidden coupling.
- Error handling that discards, logs-only, or normalizes away actionable failure.
- A split motivated only by line count when the resulting modules are less
  coherent.

Do not weaponize these principles for taste arguments. Use them when they
explain concrete cognitive load, bug risk, or future-change cost.
