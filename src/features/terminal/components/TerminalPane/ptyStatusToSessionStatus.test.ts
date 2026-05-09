import { describe, expect, test } from 'vitest'
import { ptyStatusToSessionStatus } from './ptyStatusToSessionStatus'

describe('ptyStatusToSessionStatus', () => {
  test('idle maps to paused', () => {
    expect(ptyStatusToSessionStatus('idle')).toBe('paused')
  })

  test('running maps to running', () => {
    expect(ptyStatusToSessionStatus('running')).toBe('running')
  })

  test('exited maps to completed', () => {
    expect(ptyStatusToSessionStatus('exited')).toBe('completed')
  })

  test('error maps to errored', () => {
    expect(ptyStatusToSessionStatus('error')).toBe('errored')
  })
})
