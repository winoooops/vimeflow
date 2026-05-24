import { AgentRenameError } from '../../../lib/backend'
import type { Pane } from '../types'

export const isExpectedNonAgentRenameFailure = (error: unknown): boolean =>
  error instanceof AgentRenameError &&
  (error.reason === 'no-live-agent' || error.reason === 'unsupported-agent')

export const supportsAgentRename = (
  agentType: Pane['agentType'] | null | undefined
): boolean => agentType === 'claude-code' || agentType === 'codex'

export const isExpectedLocalOnlyRenameFailure = (
  error: unknown,
  agentType: Pane['agentType'] | null | undefined
): boolean =>
  isExpectedNonAgentRenameFailure(error) && !supportsAgentRename(agentType)
