# Sub-spec 7: Frontend ToolCallSummary + Remaining Sections

**Parent:** `CLAUDE.md`
**Depends on:** Sub-spec 4 (types + hook)
**Scope:** Tool call aggregation, recent tool calls list, files changed, and test results.

## Files to Create

```
src/features/agent-status/components/
├── ToolCallSummary.tsx       // Aggregated chips + active tool indicator
├── RecentToolCalls.tsx       // Collapsible list of last 5-10 calls
├── FilesChanged.tsx          // File list with badges
├── TestResults.tsx           // Pass/fail segmented bar
└── CollapsibleSection.tsx    // Shared expand/collapse wrapper
```

## Files to Modify

- `src/features/agent-status/components/AgentStatusPanel.tsx` — render all sections

## Design Reference

- Visual: `docs/design/agent_status_sidebar/code.html` — Tool Calls, Recent, Files Changed, and Tests sections. Its footer is stale; session duration, turns, and line deltas now live in the global bottom `StatusBar`.

## CollapsibleSection (shared)

Reusable wrapper for sections that can expand/collapse.

```typescript
interface CollapsibleSectionProps {
  title: string
  count?: number | string // Optional count badge
  defaultExpanded?: boolean // Default: false
  children: React.ReactNode
}
```

- Header: uppercase label (`text-[10px] font-black text-outline tracking-[0.15em]`) + chevron
- Chevron rotates on toggle: `▸` (collapsed) → `▾` (expanded)
- Border top: `border-t border-outline-variant/[0.08]`
- Animate content with `max-height` transition or conditional render

## ToolCallSummary

### Props

```typescript
interface ToolCallSummaryProps {
  total: number
  byType: Record<string, number>
  active: ActiveToolCall | null
}
```

### Layout

1. **Header**: "TOOL CALLS" + total count (not collapsible — always visible)
2. **Chips**: flex-wrap row of tool type chips, each showing `name count`
   - Chip style: `bg-surface-container-high rounded-md px-2 py-1`
   - Name: `text-[9px] text-on-surface-variant`
   - Count: `text-[9px] font-mono text-primary font-semibold`
   - Sort chips by count descending
3. **Active tool indicator** (only when `active` is not null):
   - Green left border: `border-l-2 border-success`
   - Background: `bg-success/[0.06]`
   - Pulsing green dot + "Running" label + tool name
   - Args on second line, truncated with `truncate` class

## RecentToolCalls

### Props

```typescript
interface RecentToolCallsProps {
  calls: RecentToolCall[] // Last 5-10, newest first
}
```

### Layout

- Uses `CollapsibleSection` with `title="Recent"`, `count={calls.length}`, `defaultExpanded={false}`
- Each entry:
  - Tool name in mono font
  - Truncated args
  - Status icon: ✓ (done, `text-success`) or ✗ (failed, `text-error`)
  - Duration: e.g., "1.2s" (if available)
- Entries separated by spacing, no borders

## FilesChanged

### Props

```typescript
interface FilesChangedProps {
  files: FileChangeItem[]
}

interface FileChangeItem {
  path: string
  type: 'new' | 'modified' | 'deleted'
}
```

### Layout

- Uses `CollapsibleSection` with `title="Files Changed"`, `count={files.length}`
- Each file entry:
  - Path in mono font, truncated
  - Prefix symbol: `+` (new, `text-success`), `~` (modified, `text-secondary`), `-` (deleted, `text-error`)
  - Badge: "NEW" / "EDIT" / "DEL" in `text-outline text-[9px]`

## TestResults

### Props

```typescript
interface TestResultsProps {
  passed: number
  failed: number
  total: number
}
```

### Layout

- Uses `CollapsibleSection` with `title="Tests"`, `count={`${passed}/${total}`}`
- Segmented bar: flex row of `div` elements
  - Each segment: `flex-1 h-[3px] rounded-full`
  - Passed: `bg-success`
  - Failed: `bg-error/40`
- Count text: `text-[10px] font-mono text-success font-bold` (green if all pass, warning otherwise)

## Acceptance Criteria

- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes
- [ ] Tests: ToolCallSummary renders chips sorted by count
- [ ] Tests: ToolCallSummary shows/hides active tool indicator
- [ ] Tests: RecentToolCalls starts collapsed, expands on click
- [ ] Tests: FilesChanged renders correct prefix symbols and colors
- [ ] Tests: TestResults renders correct number of bar segments
- [ ] Tests: CollapsibleSection toggles content visibility
- [ ] All test files co-located
- [ ] No `console.log` statements
- [ ] Uses `test()` not `it()` for Vitest

## Notes

- The `CollapsibleSection` pattern already exists in `src/features/workspace/components/AgentActivity/CollapsibleSection.tsx` — look at it for reference but create a new one in `agent-status/` to avoid coupling
- Turn count, session duration, and line deltas are not rendered in this panel anymore; the global bottom `StatusBar` owns that ambient session readout.
- File changes are derived from tool calls (Edit/Write tools) in the `useAgentStatus` hook, not from a separate data source
