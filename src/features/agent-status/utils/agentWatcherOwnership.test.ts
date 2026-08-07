import { describe, expect, test } from 'vitest'
import {
  isAgentWatcherRetained,
  releaseAgentWatcher,
  retainAgentWatcher,
} from './agentWatcherOwnership'

describe('agentWatcherOwnership', () => {
  test('tracks retained watcher ownership by PTY', () => {
    retainAgentWatcher('pty-kimi')

    expect(isAgentWatcherRetained('pty-kimi')).toBe(true)

    releaseAgentWatcher('pty-kimi')

    expect(isAgentWatcherRetained('pty-kimi')).toBe(false)
  })
})
