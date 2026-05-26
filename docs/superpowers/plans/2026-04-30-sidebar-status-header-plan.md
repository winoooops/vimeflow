# Sidebar Status Header Plan

**Status:** Superseded by shipped sidebar header + global bottom status bar.

The original plan moved agent identity into the sidebar and tried to repair
the old activity-panel footer. The current UI no longer has that footer:
duration, turn count, cache hit rate, and line deltas are owned by the global
bottom `StatusBar`.

Current follow-up work should happen against:

- `src/components/StatusBar.tsx`
- `src/features/workspace/WorkspaceView.tsx`
- `src/features/agent-status/components/AgentStatusPanel/index.tsx`
