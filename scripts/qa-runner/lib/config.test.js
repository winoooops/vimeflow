import { afterEach, describe, expect, test } from 'vitest'
import { loadConfig } from './config.js'

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('loadConfig', () => {
  test('uses the default approve label', () => {
    delete process.env.QA_APPROVE_LABEL

    expect(loadConfig().approveLabel).toBe('auto-approve')
  })

  test('preserves an empty approve label as the approval kill switch', () => {
    process.env.QA_APPROVE_LABEL = ''

    expect(loadConfig().approveLabel).toBe('')
  })

  test('allows overriding the approve label through env', () => {
    process.env.QA_APPROVE_LABEL = 'merge-me'

    expect(loadConfig().approveLabel).toBe('merge-me')
  })

  test('keeps burst workers warm long enough for slow review rounds by default', () => {
    delete process.env.QA_WORKER_IDLE_STOP_SECONDS

    expect(loadConfig().workerIdleStopSeconds).toBe(2100)
  })

  test('allows overriding burst worker idle stop delay through env', () => {
    process.env.QA_WORKER_IDLE_STOP_SECONDS = '3'

    expect(loadConfig().workerIdleStopSeconds).toBe(3)
  })
})
