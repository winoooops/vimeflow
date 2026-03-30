---
paths:
  - '**/*.ts'
  - '**/*.tsx'
  - '**/*.js'
  - '**/*.jsx'
---

# TypeScript/JavaScript Patterns

> This file extends [common/patterns.md](../common/patterns.md) with TypeScript/JavaScript specific content.

## API Response Format

```typescript
interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
  meta?: {
    total: number
    page: number
    limit: number
  }
}
```

## Custom Hooks Pattern

```typescript
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay)
    return () => clearTimeout(handler)
  }, [value, delay])

  return debouncedValue
}
```

## Repository Pattern

```typescript
interface Repository<T> {
  findAll(filters?: Filters): Promise<T[]>
  findById(id: string): Promise<T | null>
  create(data: CreateDto): Promise<T>
  update(id: string, data: UpdateDto): Promise<T>
  delete(id: string): Promise<void>
}
```

## Tauri Invoke Patterns

### Type-Safe Invoke Wrapper

Define typed wrappers around `invoke()` to enforce type safety at the IPC boundary:

```typescript
import { invoke } from '@tauri-apps/api/core'

// Define command signatures
type Commands = {
  get_conversation: { args: { id: string }; return: Conversation }
  save_conversation: { args: { data: ConversationData }; return: void }
  export_conversations: {
    args: { format: 'json' | 'markdown' }
    return: string
  }
}

// Type-safe invoke
async function invokeCommand<K extends keyof Commands>(
  cmd: K,
  args: Commands[K]['args']
): Promise<Commands[K]['return']> {
  return invoke(cmd, args)
}
```

### Event Listener Cleanup

Always clean up Tauri event listeners to prevent memory leaks:

```typescript
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

// In React
useEffect(() => {
  let unlisten: UnlistenFn

  listen('backend-event', (event) => {
    // handle event
  }).then((fn) => {
    unlisten = fn
  })

  return () => {
    unlisten?.()
  }
}, [])
```

### Serialization Boundary

Data crossing the IPC boundary must be JSON-serializable. Avoid:

- `Date` objects (use ISO 8601 strings)
- `Map` / `Set` (use plain objects / arrays)
- `BigInt` (use string representation)
- `undefined` (use `null` or omit the field)
- Functions or class instances
