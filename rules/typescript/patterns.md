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

## Electron Sidecar Invoke Patterns

> The frontend bridge in `src/lib/backend.ts` exposes runtime-neutral `invoke` and `listen` helpers that delegate to `window.vimeflow.{invoke,listen}` set by the Electron preload script. The preload forwards to the `vimeflow-backend` Rust sidecar over LSP-framed JSON IPC.
>
> Historical note: the renderer used to import directly from `@tauri-apps/api/core` / `@tauri-apps/api/event`. PR-D3 (2026-05-16) removed the Tauri runtime; the bridge below is the only allowed IPC entry point.

### Type-safe `invoke` wrapper

Define typed wrappers around the bridge's `invoke` to enforce type safety at the IPC boundary:

```typescript
import { invoke } from '@/lib/backend'

// Define command signatures
type Commands = {
  spawn_pty: { args: { request: SpawnPtyRequest }; return: PtySession }
  list_sessions: { args: undefined; return: SessionList }
  git_status: { args: { cwd: string }; return: ChangedFile[] }
}

// Type-safe invoke
async function invokeCommand<K extends keyof Commands>(
  cmd: K,
  args: Commands[K]['args']
): Promise<Commands[K]['return']> {
  return invoke(cmd, args as Record<string, unknown> | undefined)
}
```

Most production callers use the Rust-generated `ts-rs` types from `src/bindings/` directly rather than redefining the schema.

### Event listener cleanup

The bridge's `listen` returns an idempotent `UnlistenFn` (the `called`-guard wrapper survives React StrictMode's mount → cleanup → remount double-fire):

```typescript
import { listen, type UnlistenFn } from '@/lib/backend'

useEffect(() => {
  let unlisten: UnlistenFn | undefined

  void listen('pty-data', (payload) => {
    // payload is the bare value, NOT a Tauri Event<T> envelope.
    // Type the callback with the generated ts-rs binding.
  }).then((fn) => {
    unlisten = fn
  })

  return () => {
    unlisten?.()
  }
}, [])
```

Critical: always `await` the `listen(...)` promise (or `.then()` it) before triggering an IPC call that depends on the listener being attached. The bridge resolves only after the transport listener attaches; race conditions surface as dropped events on the first frame.

### Serialization boundary

Data crossing the IPC boundary travels as LSP-framed JSON. Avoid:

- `Date` objects (use ISO 8601 strings)
- `Map` / `Set` (use plain objects / arrays)
- `BigInt` (use string representation)
- `undefined` (use `null` or omit the field)
- Functions or class instances

### Rejection contract

The sidecar's `_inner` helpers return `Result<T, String>`; the IPC router puts the string in the response frame's `error` field; the preload unwraps the `{ ok, result, error }` envelope and throws the bare string. The bridge's `invoke` propagates that bare-string rejection unchanged:

```ts
await expect(invoke('write_pty', { id: 'missing' })).rejects.toBe(
  'PTY session not found'
)
```

Production callers can `.catch((err) => ...)` with `err` typed as `unknown`; assert `typeof err === 'string'` before forwarding to UI surfaces.
