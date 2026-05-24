import { AgentRenameError } from '../../../lib/backend'

export const isExpectedNonAgentRenameFailure = (error: unknown): boolean =>
  error instanceof AgentRenameError &&
  (error.reason === 'no-live-agent' || error.reason === 'unsupported-agent')
