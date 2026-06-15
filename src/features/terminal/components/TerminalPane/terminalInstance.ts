import type { TerminalInstance } from '../../types'
import { createXtermTerminal } from './xtermInstance'

export const createTerminalInstance = (): TerminalInstance =>
  createXtermTerminal()
