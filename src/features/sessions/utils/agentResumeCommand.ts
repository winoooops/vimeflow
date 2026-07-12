import { AGENTS, agentTypeToRegistryKey } from '@/agents/registry'
import type { Pane } from '../types'

const SAFE_AGENT_SESSION_ID = /^[A-Za-z0-9_-]{1,256}$/

export const buildAgentResumeCommand = (
  agentType: Pane['agentType'],
  agentSessionId: string | null | undefined
): string | null => {
  const commands = AGENTS[agentTypeToRegistryKey(agentType)].resumeCommands

  if (
    commands === null ||
    (agentSessionId !== null &&
      agentSessionId !== undefined &&
      !SAFE_AGENT_SESSION_ID.test(agentSessionId))
  ) {
    return null
  }

  return agentSessionId === null || agentSessionId === undefined
    ? commands.latest
    : `${commands.byIdPrefix} '${agentSessionId}'`
}
