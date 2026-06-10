import { afterEach, describe, expect, test, vi } from 'vitest'
import { createLogger } from './log'

describe('createLogger', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('prefixes messages with the namespace at each level', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const log = createLogger('restore')
    log.info('hydrating')
    log.warn('slow')
    log.error('failed')

    expect(info).toHaveBeenCalledWith('[vimeflow:restore] hydrating')
    expect(warn).toHaveBeenCalledWith('[vimeflow:restore] slow')
    expect(error).toHaveBeenCalledWith('[vimeflow:restore] failed')
  })

  test('forwards structured context arguments after the message', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

    const log = createLogger('restore')
    const context = { sessionCount: 3, layout: 'quad' }
    log.info('reconstructed', context)

    expect(info).toHaveBeenCalledWith(
      '[vimeflow:restore] reconstructed',
      context
    )
  })
})
