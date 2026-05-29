export interface PaneCandidate {
  paneId: string
  ptyId: string
  tabName: string
  agentLabel: string
  cwd: string
  status: 'idle' | 'running' | 'exited' | 'error'
  isFocused: boolean
}

export interface ResolveCandidatesArgs {
  allPanes: PaneCandidate[]
  diffCwd: string
  focusedPaneId: string | null
}

export type ResolveResult =
  | { kind: 'none' }
  | { kind: 'one'; pane: PaneCandidate }
  | { kind: 'many'; candidates: PaneCandidate[] }

export type SupportedAgent = 'Claude Code' | 'Codex'

const SUPPORTED_AGENTS: readonly SupportedAgent[] = ['Claude Code', 'Codex']

const isSupportedAgent = (label: string): boolean =>
  SUPPORTED_AGENTS.some((agent) => agent === label)

const isMatchingCwd = (paneCwd: string, diffCwd: string): boolean =>
  paneCwd === diffCwd || paneCwd.startsWith(diffCwd + '/')

// Filter to panes whose cwd matches the diff cwd (exact or descendant), whose
// agentLabel is a SUPPORTED_AGENT, and whose status === 'running'. Then route:
// 0 candidates -> none; 1 -> one; many with a focused match -> that focused one;
// many without -> many.
export const resolveCandidatePanes = (
  args: ResolveCandidatesArgs
): ResolveResult => {
  const candidates = args.allPanes.filter(
    (p) =>
      isMatchingCwd(p.cwd, args.diffCwd) &&
      isSupportedAgent(p.agentLabel) &&
      p.status === 'running'
  )

  if (candidates.length === 0) {
    return { kind: 'none' }
  }

  if (candidates.length === 1) {
    return { kind: 'one', pane: candidates[0] }
  }

  const focused = candidates.find((p) => p.paneId === args.focusedPaneId)

  if (focused) {
    return { kind: 'one', pane: focused }
  }

  return { kind: 'many', candidates }
}
