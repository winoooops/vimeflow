---
paths:
  - '**/*.ts'
  - '**/*.tsx'
  - '**/*.js'
  - '**/*.jsx'
---

# TypeScript/JavaScript Coding Style

> This file extends [common/coding-style.md](../../common/coding-style.md) with TypeScript/JavaScript specific content.

## Types and Interfaces

Use types to make public APIs, shared models, and component props explicit, readable, and reusable.

### Public APIs

- Add parameter and return types to exported functions, shared utilities, and public class methods
- Let TypeScript infer obvious local variable types
- Extract repeated inline object shapes into named types or interfaces

```typescript
// WRONG: Exported function without explicit types
export function formatUser(user) {
  return `${user.firstName} ${user.lastName}`
}

// CORRECT: Explicit types on public APIs
interface User {
  firstName: string
  lastName: string
}

export function formatUser(user: User): string {
  return `${user.firstName} ${user.lastName}`
}
```

### Interfaces vs. Type Aliases

- Use `interface` for object shapes that may be extended or implemented
- Use `type` for unions, intersections, tuples, mapped types, and utility types
- Prefer string literal unions over `enum` unless an `enum` is required for interoperability

```typescript
interface User {
  id: string
  email: string
}

type UserRole = 'admin' | 'member'
type UserWithRole = User & {
  role: UserRole
}
```

### Avoid `any`

- Avoid `any` in application code
- Use `unknown` for external or untrusted input, then narrow it safely
- Use generics when a value's type depends on the caller

```typescript
// WRONG: any removes type safety
function getErrorMessage(error: any) {
  return error.message
}

// CORRECT: unknown forces safe narrowing
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return 'Unexpected error'
}
```

### React Props

- Define component props with a named `interface` or `type`
- Type callback props explicitly
- Do not use `React.FC` unless there is a specific reason to do so
- Components must be arrow functions (enforced by `react/function-component-definition`)

```typescript
interface User {
  id: string
  email: string
}

interface UserCardProps {
  user: User
  onSelect: (id: string) => void
}

const UserCard = ({ user, onSelect }: UserCardProps): JSX.Element => (
  <button onClick={() => onSelect(user.id)}>{user.email}</button>
)
```

### JavaScript Files

- In `.js` and `.jsx` files, use JSDoc when types improve clarity and a TypeScript migration is not practical
- Keep JSDoc aligned with runtime behavior

```javascript
/**
 * @param {{ firstName: string, lastName: string }} user
 * @returns {string}
 */
export function formatUser(user) {
  return `${user.firstName} ${user.lastName}`
}
```

## Immutability

Use spread operator for immutable updates:

```typescript
interface User {
  id: string
  name: string
}

// WRONG: Mutation
function updateUser(user: User, name: string): User {
  user.name = name // MUTATION!
  return user
}

// CORRECT: Immutability
function updateUser(user: Readonly<User>, name: string): User {
  return {
    ...user,
    name,
  }
}
```

## Error Handling

Use async/await with try-catch and narrow unknown errors safely:

```typescript
interface User {
  id: string
  email: string
}

declare function riskyOperation(userId: string): Promise<User>

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return 'Unexpected error'
}

const logger = {
  error: (message: string, error: unknown) => {
    // Replace with your production logger (for example, pino or winston).
  },
}

async function loadUser(userId: string): Promise<User> {
  try {
    const result = await riskyOperation(userId)
    return result
  } catch (error: unknown) {
    logger.error('Operation failed', error)
    throw new Error(getErrorMessage(error))
  }
}
```

## Input Validation

Use Zod for schema-based validation and infer types from the schema:

```typescript
import { z } from 'zod'

const userSchema = z.object({
  email: z.string().email(),
  age: z.number().int().min(0).max(150),
})

type UserInput = z.infer<typeof userSchema>

const validated: UserInput = userSchema.parse(input)
```

## Component Accessibility

React components must use semantic HTML and ARIA attributes to be accessible. Key rules:

- Use semantic elements (`<nav>`, `<aside>`, `<figure>`, `<search>`, `<h2>`) over generic `<div>`
- Add `role` and `aria-label` when semantic HTML alone is insufficient
- Material Icon spans must have `aria-hidden="true"`; the parent element carries the accessible name
- Every a11y attribute must be verified by a corresponding test query

For component-level a11y patterns with WRONG/CORRECT JSX examples, see [a11y-components.md](./a11y-components.md).

## Linting

ESLint flat config (`eslint.config.js`) enforces these standards. Key enforced rules:

### TypeScript Strictness

- `@typescript-eslint/explicit-function-return-type`: error — all functions must have explicit return types
- `@typescript-eslint/no-unnecessary-condition`: error — no redundant conditionals
- `@typescript-eslint/no-shadow`: error — no variable shadowing
- Type-checked rules enabled via `recommendedTypeChecked` and `stylisticTypeChecked`

### React Conventions

- Arrow-function components only (`react/function-component-definition`)
- Self-closing tags for empty elements (`react/self-closing-comp`)
- No unnecessary JSX curly braces (`react/jsx-curly-brace-presence`)
- No boolean `={true}` in JSX (`react/jsx-boolean-value`)
- Default props via default arguments (`react/require-default-props`)

### Code Style

- `no-console`: error — use structured logging, never `console.log`
- `arrow-body-style`: error — concise arrow bodies where possible
- `object-shorthand`: error — use shorthand property/method syntax
- `curly`: error, always — all control flow blocks must use braces
- `promise/prefer-await-to-then`: error — use `await` instead of `.then()` chains

### Import Organization

- `import/first`: error — imports must be at the top
- `import/no-duplicates`: error — no duplicate import sources
- `import/newline-after-import`: error — blank line after import block

### Formatting

- Prettier handles formatting (eslint-config-prettier disables conflicting rules)
- `@stylistic/padding-line-between-statements` enforces blank lines around interfaces, exports, multiline expressions, and return statements

### Spell Checking

- `@cspell/spellchecker` enforces spelling via `cspell.config.yaml`

### Test Files

- Vitest with `test()` (not `it()`) via `vitest/consistent-test-it`
- Testing Library rules for `*.test.tsx` files
- Relaxed type-checking in test files (`no-unsafe-assignment` and `unbound-method` off)
