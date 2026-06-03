import { describe, expect, test } from 'vitest'
import { formatLinearEventComment } from './events.js'

describe('formatLinearEventComment', () => {
  test('formats retryable process exits with explicit reason and log path', () => {
    const body = formatLinearEventComment({
      type: 'error',
      pr: 42,
      sourceEvent: 'poll',
      category: 'transient',
      detail: 'watch.js transient (exit -1)',
      exitCode: -1,
      signal: 'SIGTERM',
      exitReason: 'watch.js terminated by SIGTERM',
      logPath: '/repo/scripts/qa-runner/logs/pr-42.log',
      retryMode: 'next poll tick',
      terminal: false,
    })

    expect(body).toContain('## QA runner cycle exit: RETRY')
    expect(body).toContain('| PR | #42 |')
    expect(body).toContain('| Source event | poll |')
    expect(body).toContain('| Category | transient |')
    expect(body).toContain('| Exit code | `-1` |')
    expect(body).toContain('| Signal | `SIGTERM` |')
    expect(body).toContain('| Reason | watch.js terminated by SIGTERM |')
    expect(body).toContain('| Log | `/repo/scripts/qa-runner/logs/pr-42.log` |')
    expect(body).toContain('| Retry mode | next poll tick |')
    expect(body).toContain('Poll-triggered exits retry on the next poll tick')
  })

  test('formats paused process exits as terminal loop stops', () => {
    const body = formatLinearEventComment({
      type: 'paused',
      pr: 42,
      sourceEvent: 'poll',
      category: 'fixer_stall',
      detail: 'fixer stall (watch.js exit 1)',
      exitCode: 1,
      signal: null,
      exitReason: 'kimi produced no commit',
      noopCount: 3,
      maxNoops: 3,
      terminal: true,
    })

    expect(body).toContain('## QA runner cycle exit: PAUSED')
    expect(body).toContain('| Failed attempts | 3 / 3 |')
    expect(body).toContain('loop paused')
  })
})
