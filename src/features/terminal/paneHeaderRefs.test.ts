import { afterEach, describe, expect, test } from 'vitest'
import { _resetForTest, get, register, unregister } from './paneHeaderRefs'

describe('paneHeaderRefs', () => {
  afterEach(() => {
    _resetForTest()
  })

  test('registers and unregisters pane header elements', () => {
    const header = document.createElement('div')

    register('pty-1', header)

    expect(get('pty-1')).toBe(header)

    unregister('pty-1')

    expect(get('pty-1')).toBeUndefined()
  })

  test('reset clears all registered pane headers', () => {
    register('pty-1', document.createElement('div'))
    register('pty-2', document.createElement('div'))

    _resetForTest()

    expect(get('pty-1')).toBeUndefined()
    expect(get('pty-2')).toBeUndefined()
  })
})
