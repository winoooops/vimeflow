// cspell:ignore vsplit
import { describe, test, expect, beforeEach, vi } from 'vitest'
import { __resetBackendEventSubscriptions, type BackendApi } from './backend'
import {
  clearRecordedPtyDataEvents,
  getRecordedPtyDataEvents,
  getVisibleTerminalSize,
  readPaneBuffer,
  startRecordingPtyDataEvents,
  stopRecordingPtyDataEvents,
  writeInputToVisibleTerminal,
  writeOutputToVisibleTerminal,
} from './e2e-bridge'
import { terminalCache } from '../features/terminal/terminalRegistry'

type CacheEntry = ReturnType<typeof terminalCache.get>
type BackendEventCallback = (payload: unknown) => void
type BackendInvokeMock = (
  method: string,
  args?: Record<string, unknown>
) => Promise<unknown>

let backendEventCallbacks = new Map<string, BackendEventCallback>()
let invokeMock: ReturnType<typeof vi.fn<BackendInvokeMock>>

interface MockViewportReader {
  readVisibleText: () => string
}

const makeMockEntry = (rows: readonly string[]): CacheEntry => {
  const viewportReader: MockViewportReader = {
    readVisibleText: (): string => {
      const visibleRows = rows.map((row) => row.replace(/\s+$/, ''))

      return visibleRows.join('\n').replace(/\n+$/, '')
    },
  }

  return {
    terminal: { cols: 80, dispose: (): void => undefined, rows: 24 },
    output: { writeOutput: vi.fn() },
    fitController: { fit: (): void => undefined },
    viewportReader,
  } as unknown as CacheEntry
}

const visibleDomRect = (): DOMRect =>
  ({
    bottom: 24,
    height: 24,
    left: 0,
    right: 80,
    top: 0,
    width: 80,
    x: 0,
    y: 0,
    toJSON: (): Record<string, never> => ({}),
  }) as DOMRect

const emitBackendEvent = (event: string, payload: unknown): void => {
  backendEventCallbacks.get(event)?.(payload)
}

const installBackendBridge = (): void => {
  invokeMock = vi.fn<BackendInvokeMock>().mockResolvedValue(null)

  const invokeBridge: BackendApi['invoke'] = async <T>(
    method: string,
    args?: Record<string, unknown>
  ): Promise<T> => (await invokeMock(method, args)) as T

  const listenBridge: BackendApi['listen'] = <T>(
    event: string,
    callback: (payload: T) => void
  ): Promise<() => void> => {
    backendEventCallbacks.set(event, (payload: unknown): void => {
      callback(payload as T)
    })

    return Promise.resolve((): void => {
      backendEventCallbacks.delete(event)
    })
  }

  window.vimeflow = {
    invoke: invokeBridge,
    listen: listenBridge,
  }
}

/**
 * Build a session-level wrapper containing N split-view-slots, each with
 * an inner terminal-pane-wrapper (one carrying `data-focused="true"` when
 * `activeIndex` matches) and a legacy xterm DOM rows fallback child with the
 * provided text content. Mirrors the post-5b DOM shape produced by SplitView →
 * TerminalPane → Body.
 */
const buildSessionWrapper = (
  paneTexts: readonly string[],
  activeIndex: number
): HTMLElement => {
  const sessionWrapper = document.createElement('div')
  sessionWrapper.setAttribute('data-testid', 'terminal-pane')
  sessionWrapper.setAttribute('data-session-id', 'sess-fix')

  const splitView = document.createElement('div')
  splitView.setAttribute('data-testid', 'split-view')
  sessionWrapper.appendChild(splitView)

  paneTexts.forEach((text, i) => {
    const slot = document.createElement('div')
    slot.setAttribute('data-testid', 'split-view-slot')
    slot.setAttribute('data-pane-id', `p${i}`)
    slot.setAttribute('data-pty-id', `pty-${i}`)

    const paneWrapper = document.createElement('div')
    paneWrapper.setAttribute('data-testid', 'terminal-pane-wrapper')
    if (i === activeIndex) {
      paneWrapper.setAttribute('data-focused', 'true')
    }

    // Body's inner container — carries data-pty-id (terminalCache key), mirroring production DOM.
    const bodyContainer = document.createElement('div')
    bodyContainer.setAttribute('data-testid', 'terminal-pane')
    bodyContainer.setAttribute('data-pty-id', `pty-${i}`)

    const rows = document.createElement('div')
    rows.className = 'xterm-rows'
    rows.textContent = text

    bodyContainer.appendChild(rows)
    paneWrapper.appendChild(bodyContainer)
    slot.appendChild(paneWrapper)
    splitView.appendChild(slot)
  })

  return sessionWrapper
}

describe('readPaneBuffer', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    terminalCache.clear()
    backendEventCallbacks = new Map()
    stopRecordingPtyDataEvents()
    clearRecordedPtyDataEvents()
    __resetBackendEventSubscriptions()
    installBackendBridge()
  })

  test('returns the focused pane legacy DOM fallback in multi-pane DOM', () => {
    // Three panes; active = index 1. A naive unscoped legacy DOM query would
    // return panes[0]'s buffer.
    const wrapper = buildSessionWrapper(
      ['pane-zero-buf', 'pane-one-buf', 'pane-two-buf'],
      1
    )

    expect(readPaneBuffer(wrapper)).toBe('pane-one-buf')
  })

  test('returns the only pane legacy DOM fallback for a single-pane wrapper', () => {
    const wrapper = buildSessionWrapper(['solo-buf'], 0)

    expect(readPaneBuffer(wrapper)).toBe('solo-buf')
  })

  test('falls back to first legacy DOM rows when no pane carries data-focused', () => {
    // Defensive case — invariant violation (5a guarantees exactly-one
    // active per session). The function must still return SOMETHING
    // (not throw) so e2e specs don't fail cryptically. Returns the
    // first match in DOM order per legacy semantics.
    const wrapper = buildSessionWrapper(['first-buf', 'second-buf'], -1)

    expect(readPaneBuffer(wrapper)).toBe('first-buf')
  })

  test('returns empty string when no cache or legacy DOM rows are present', () => {
    const wrapper = document.createElement('div')
    wrapper.setAttribute('data-testid', 'terminal-pane')
    // No inner content — no slot, no cached terminal, no legacy DOM rows.

    expect(readPaneBuffer(wrapper)).toBe('')
  })

  test('reads legacy DOM rows directly when passed a split-view-slot without cache', () => {
    // `readTerminalBufferForSession`'s pty-id fallback path resolves to
    // a `split-view-slot`, not the session wrapper. The function must
    // descend into the slot's inner terminal-pane-wrapper just the
    // same.
    const wrapper = buildSessionWrapper(['slot-buf'], 0)

    const slot = wrapper.querySelector<HTMLElement>(
      '[data-testid="split-view-slot"]'
    )

    expect(slot).not.toBeNull()
    expect(readPaneBuffer(slot!)).toBe('slot-buf')
  })

  test('reads TerminalViewportReader text when legacy DOM rows are empty', () => {
    // Canvas/WebGL renderers leave xterm DOM rows empty. The bridge must reach
    // into terminalCache by PTY id and use the renderer-neutral viewport reader.
    const wrapper = buildSessionWrapper([''], 0)
    terminalCache.set('pty-0', makeMockEntry(['$ echo hi', 'hi', '$ '])!)

    expect(readPaneBuffer(wrapper)).toBe('$ echo hi\nhi\n$')
  })

  test('reads TerminalViewportReader text when renderer exposes no legacy DOM rows', () => {
    const wrapper = buildSessionWrapper(['stale-dom-row'], 0)
    wrapper.querySelector('.xterm-rows')?.remove()
    terminalCache.set('pty-0', makeMockEntry(['generic renderer text'])!)

    expect(readPaneBuffer(wrapper)).toBe('generic renderer text')
  })

  test('uses data-pty-id from Body container, not data-session-id from TerminalZone', () => {
    // Production bug class: cache is keyed by pane.ptyId but TerminalZone exposes data-session-id={session.id}.
    const wrapper = buildSessionWrapper([''], 0)
    terminalCache.set('sess-fix', makeMockEntry(['WRONG — session-id key'])!)
    terminalCache.set('pty-0', makeMockEntry(['right — pty-id key'])!)

    expect(readPaneBuffer(wrapper)).toBe('right — pty-id key')
  })

  test('falls-back via descendant search when given an inner terminal-pane-wrapper', () => {
    // resolveCacheKey must descend into the pane-wrapper to find Body's data-pty-id.
    const wrapper = buildSessionWrapper([''], 0)
    terminalCache.set('pty-0', makeMockEntry(['inner-pane-buf'])!)

    const inner = wrapper.querySelector<HTMLElement>(
      '[data-testid="terminal-pane-wrapper"]'
    )

    expect(inner).not.toBeNull()
    expect(readPaneBuffer(inner!)).toBe('inner-pane-buf')
  })

  test('prefers TerminalViewportReader text over stale legacy DOM rows', () => {
    const wrapper = buildSessionWrapper(['stale-dom-row'], 0)
    terminalCache.set('pty-0', makeMockEntry(['row-5', 'row-6'])!)

    expect(readPaneBuffer(wrapper)).toBe('row-5\nrow-6')
  })

  test('falls back to legacy DOM rows when cached viewport text is empty', () => {
    const wrapper = buildSessionWrapper(['dom-row'], 0)
    terminalCache.set('pty-0', makeMockEntry([])!)

    expect(readPaneBuffer(wrapper)).toBe('dom-row')
  })

  test('returns empty string when legacy DOM rows are empty and the cache has no entry', () => {
    // No DOM text AND no cached terminal — the legacy fallback path.
    const wrapper = buildSessionWrapper([''], 0)

    expect(readPaneBuffer(wrapper)).toBe('')
  })

  test('writes output chunks to the visible terminal renderer', () => {
    const wrapper = buildSessionWrapper([''], 0)
    wrapper.getBoundingClientRect = visibleDomRect

    const entry = makeMockEntry([])

    terminalCache.set('pty-0', entry!)
    document.body.append(wrapper)

    expect(writeOutputToVisibleTerminal('hello')).toBe(true)
    expect(entry?.output.writeOutput).toHaveBeenCalledWith({
      text: 'hello',
      bytesBase64: 'aGVsbG8=',
      offsetStart: expect.any(Number),
      byteLen: 5,
      phase: 'live',
    })
  })

  test('writes input to the visible pane pty through the backend bridge', async () => {
    const wrapper = buildSessionWrapper([''], 0)
    wrapper.getBoundingClientRect = visibleDomRect

    terminalCache.set('pty-0', makeMockEntry([])!)
    document.body.append(wrapper)

    await expect(writeInputToVisibleTerminal('printf ok\n')).resolves.toBe(true)
    expect(invokeMock).toHaveBeenCalledWith('write_pty', {
      request: {
        sessionId: 'pty-0',
        data: 'printf ok\n',
      },
    })
  })

  test('does not write input when no visible terminal is mounted', async () => {
    await expect(writeInputToVisibleTerminal('printf nope\n')).resolves.toBe(
      false
    )
    expect(invokeMock).not.toHaveBeenCalled()
  })

  test('records pty-data events with byte payload metadata', async () => {
    await startRecordingPtyDataEvents()

    emitBackendEvent('pty-data', {
      sessionId: 'pty-0',
      data: '��',
      bytesBase64: '//4=',
      offsetStart: BigInt(42),
      byteLen: BigInt(2),
    })

    expect(getRecordedPtyDataEvents()).toEqual([
      {
        sessionId: 'pty-0',
        data: '��',
        bytesBase64: '//4=',
        offsetStart: 42,
        byteLen: 2,
      },
    ])

    clearRecordedPtyDataEvents()
    expect(getRecordedPtyDataEvents()).toEqual([])
  })

  test('returns the visible terminal size from the active cached renderer', () => {
    const wrapper = buildSessionWrapper([''], 0)
    wrapper.getBoundingClientRect = visibleDomRect

    terminalCache.set('pty-0', makeMockEntry([])!)
    document.body.append(wrapper)

    expect(getVisibleTerminalSize()).toEqual({ cols: 80, rows: 24 })
  })

  test('does not write output when no visible terminal is mounted', () => {
    expect(writeOutputToVisibleTerminal('hello')).toBe(false)
  })
})
