# Sub-spec 4: Frontend Types + Hook + Panel Shell

**Parent:** `CLAUDE.md`
**Depends on:** Sub-spec 1 (ts-rs bindings generated)
**Scope:** Frontend agent status types, Tauri event subscription hook, and the panel shell component with collapse animation. Replaces `AgentActivity` in `WorkspaceView`.

## Files to Create

```
src/features/agent-status/
├── types/
│   └── index.ts              // Frontend-specific types (extending ts-rs bindings)
├── hooks/
│   └── useAgentStatus.ts     // Subscribe to Tauri agent-* events
└── components/
    └── AgentStatusPanel.tsx   // Panel shell with 0↔280px collapse
```

## Files to Modify

- `src/features/workspace/WorkspaceView.tsx` — replace `<AgentActivity>` with `<AgentStatusPanel>`

## Types (`types/index.ts`)

Import ts-rs generated types from `src/bindings/` and define frontend-specific state:

```typescript
// Re-export relevant bindings
export type {
  AgentStatusEvent,
  AgentToolCallEvent,
  AgentDetectedEvent,
  AgentDisconnectedEvent,
} from '../../../bindings'

export interface AgentStatus {
  isActive: boolean
  agentType: 'claude-code' | 'codex' | 'aider' | 'generic' | null
  modelId: string | null
  modelDisplayName: string | null
  version: string | null
  sessionId: string | null // Vimeflow session ID
  agentSessionId: string | null // Claude Code's own session ID

  // Budget metrics
  contextWindow: ContextWindowState | null
  cost: CostState | null
  rateLimits: RateLimitsState | null

  // Activity
  toolCalls: ToolCallState
  recentToolCalls: RecentToolCall[]
}

export interface ContextWindowState {
  usedPercentage: number // 0-100
  contextWindowSize: number // 200000 or 1000000
  totalInputTokens: number
  totalOutputTokens: number
}

export interface CostState {
  totalCostUsd: number
  totalDurationMs: number
  totalApiDurationMs: number
  totalLinesAdded: number
  totalLinesRemoved: number
}

export interface RateLimitsState {
  fiveHour: { usedPercentage: number; resetsAt: number }
  sevenDay?: { usedPercentage: number; resetsAt: number }
}

export interface ToolCallState {
  total: number
  byType: Record<string, number> // e.g., { Read: 18, Edit: 12 }
  active: ActiveToolCall | null
}

export interface ActiveToolCall {
  tool: string
  args: string
}

export interface RecentToolCall {
  id: string
  tool: string
  args: string
  status: 'done' | 'failed'
  durationMs: number | null
  timestamp: string
}
```

## Hook (`useAgentStatus.ts`)

### Purpose

Subscribe to Tauri `agent-*` events, accumulate state, expose to components.

### Interface

```typescript
export const useAgentStatus = (sessionId: string | null): AgentStatus
```

### Implementation

1. Use `listen()` from `@tauri-apps/api/event` to subscribe to:
   - `agent-detected` → set `isActive`, `agentType`, `modelId`
   - `agent-status` → update `contextWindow`, `cost`, `rateLimits`
   - `agent-tool-call` → update `toolCalls.byType`, `toolCalls.active`, `recentToolCalls`
   - `agent-disconnected` → set `isActive = false`, keep last state for 5s
2. Filter events by `sessionId` — only process events for the active session
3. Manage `recentToolCalls` as a sliding window (last 10, newest first)
4. Update `toolCalls.byType` by incrementing the count for each tool type on completion
5. Clean up listeners on unmount

### State reset

When `sessionId` changes, reset all state to defaults (null/empty).

## Panel Shell (`AgentStatusPanel.tsx`)

### Purpose

Container component that handles the collapse/expand animation and renders child sections.

### Interface

```typescript
interface AgentStatusPanelProps {
  sessionId: string | null
}
```

### Behavior

- Calls `useAgentStatus(sessionId)` to get status
- When `status.isActive === false`: render at `width: 0px` with `overflow: hidden` and `transition: width 200ms ease-out`
- When `status.isActive === true`: render at `width: 280px` with `transition: width 200ms ease-in`
- Interior renders placeholder children for now (sections implemented in sub-specs 5-7):
  - `{/* StatusCard + BudgetMetrics — sub-spec 5 */}`
  - `{/* ContextBucket — sub-spec 6 */}`
  - `{/* ToolCallSummary + sections — sub-spec 7 */}`
- Use `data-testid="agent-status-panel"`

### WorkspaceView integration

Replace the existing `<AgentActivity session={activeSession} />` with `<AgentStatusPanel sessionId={activeSessionId} />`. Remove the fixed `w-[280px]` from the panel's parent — the panel manages its own width now.

## Acceptance Criteria

- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes
- [ ] `npm run test` passes
- [ ] Panel renders at 0px when no agent is active
- [ ] Panel renders at 280px when agent is active (mock the hook for testing)
- [ ] Transition animation works (CSS transition on width)
- [ ] `useAgentStatus` subscribes/unsubscribes to Tauri events correctly
- [ ] `useAgentStatus` resets state when sessionId changes
- [ ] WorkspaceView uses `AgentStatusPanel` instead of `AgentActivity`
- [ ] Test files co-located: `AgentStatusPanel.test.tsx`, `useAgentStatus.test.ts`

## Notes

- The old `AgentActivity` component and its children remain in the codebase for now — don't delete them. They'll be removed after all sub-specs are complete.
- For testing, mock `@tauri-apps/api/event` using `vi.mock()`
- The panel should not render any content when collapsed — just the empty container with `width: 0`
