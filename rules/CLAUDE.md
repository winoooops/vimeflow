# Rules

## Structure

Rules are organized into a _common_ layer plus **language-specific** directories:

```
rules/
├── common/                 # Language-agnostic principles (always install)
│   ├── coding-style.md
│   ├── git-workflow.md
│   ├── testing.md
│   ├── performance.md
│   ├── patterns.md
│   ├── hooks.md
│   ├── agents.md
│   ├── security.md
│   ├── code-review.md
│   └── development-workflow.md
├── rust/                   # Rust specific
└── typescript/             # TypeScript/JavaScript specific
```

- **common/** contains universal principles - no language-specific code examples
- **language directories** (TypeScript, Rust) extend the common rules with framework-specific patterns, tools, and code examples.
