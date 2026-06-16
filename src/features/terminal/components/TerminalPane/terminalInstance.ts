import type { TerminalInstance } from '../../types'
import { createConfiguredTerminalInstance } from './terminalRendererRegistry'

export const createTerminalInstance = async (): Promise<TerminalInstance> =>
  createConfiguredTerminalInstance()
