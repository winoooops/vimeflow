import type { AgentActivity } from './types'

/** Frozen template for a fresh AgentActivity. Callers MUST clone via
 * `{ ...emptyActivity }` rather than mutate this reference. */
export const emptyActivity: AgentActivity = {
  fileChanges: [],
  toolCalls: [],
  testResults: [],
  contextWindow: { used: 0, total: 200000, percentage: 0, emoji: '😊' },
  usage: {
    sessionDuration: 0,
    turnCount: 0,
    messages: { sent: 0, limit: 200 },
    tokens: { input: 0, output: 0, total: 0 },
  },
}
