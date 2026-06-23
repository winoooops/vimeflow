// cspell:ignore ghostty libghostty prebuilds
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import {
  GhosttyRenderStateMainBridge,
  resolveGhosttyNativePackageRoot,
  setupGhosttyRenderStateIpc,
  type GhosttyNativeBindings,
  type IpcMainEventLike,
} from './ghostty-render-state-main'
import {
  GHOSTTY_RENDER_STATE_CREATE,
  GHOSTTY_RENDER_STATE_DISPOSE,
  GHOSTTY_RENDER_STATE_READ_SNAPSHOT,
  GHOSTTY_RENDER_STATE_RESET,
  GHOSTTY_RENDER_STATE_RESIZE,
  GHOSTTY_RENDER_STATE_STATUS,
  GHOSTTY_RENDER_STATE_WRITE_BYTES,
} from './ghostty-render-state-channels'

interface TestNativeTerminal {
  feed: ReturnType<typeof vi.fn<(bytes: Uint8Array) => void>>
  resize: ReturnType<typeof vi.fn<(cols: number, rows: number) => void>>
  snapshot: ReturnType<
    typeof vi.fn<
      () => {
        rows: number
        cursorRow: number
        cursorCol: number
        cursorVisible?: boolean
        visibleLines: readonly { row: number; text: string }[]
        cells?: readonly {
          row: number
          col: number
          text: string
          width: number
          foreground?: string
          background?: string
          bold?: boolean
          reverse?: boolean
        }[]
      }
    >
  >
  dispose: ReturnType<typeof vi.fn<() => void>>
  formatHtml?: ReturnType<typeof vi.fn<() => string>>
}

interface TestIpcMain {
  readonly handlers: Map<
    string,
    (event: IpcMainEventLike, payload?: unknown) => void
  >
  on: ReturnType<
    typeof vi.fn<
      (
        channel: string,
        listener: (event: IpcMainEventLike, payload?: unknown) => void
      ) => void
    >
  >
  removeListener: ReturnType<
    typeof vi.fn<
      (
        channel: string,
        listener: (event: IpcMainEventLike, payload?: unknown) => void
      ) => void
    >
  >
}

const createNativeBindings = (): {
  bindings: GhosttyNativeBindings
  terminals: TestNativeTerminal[]
} => {
  const terminals: TestNativeTerminal[] = []

  const bindings: GhosttyNativeBindings = {
    createTerminal: vi.fn(({ rows }) => {
      const terminal: TestNativeTerminal = {
        feed: vi.fn(),
        resize: vi.fn(),
        snapshot: vi.fn(() => ({
          rows,
          cursorRow: 1,
          cursorCol: 2,
          visibleLines: [
            { row: 0, text: 'prompt' },
            { row: 1, text: 'output' },
          ],
          cells: [
            {
              row: 0,
              col: 0,
              text: 'p',
              width: 1,
              foreground: '#f38ba8',
              background: '#181825',
              bold: true,
            },
          ],
        })),
        dispose: vi.fn(),
      }

      terminals.push(terminal)

      return terminal
    }),
  }

  return { bindings, terminals }
}

const createEvent = (id = 42): IpcMainEventLike => ({
  returnValue: undefined,
  sender: {
    id,
    once: vi.fn(),
    removeListener: vi.fn(),
  },
})

const requireResult = <T>(
  value:
    | {
        ok: true
        result: T
      }
    | {
        ok: false
        error: string
      }
): T => {
  if (!value.ok) {
    throw new Error(value.error)
  }

  return value.result
}

const withTempDir = (callback: (tempDir: string) => void): void => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'vimeflow-ghostty-native-')
  )

  try {
    callback(tempDir)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

const nativePackageRootUnder = (basePath: string): string =>
  path.join(basePath, 'node_modules', '@coder', 'libghostty-vt-node')

const createNativePackage = (packageRoot: string): void => {
  fs.mkdirSync(path.join(packageRoot, 'prebuilds', 'linux-x64'), {
    recursive: true,
  })
  fs.writeFileSync(path.join(packageRoot, 'package.json'), '{}')
  fs.writeFileSync(
    path.join(packageRoot, 'prebuilds', 'linux-x64', 'ghostty.node'),
    ''
  )
}

const createIpcMain = (): TestIpcMain => {
  const handlers = new Map<
    string,
    (event: IpcMainEventLike, payload?: unknown) => void
  >()

  return {
    handlers,
    on: vi.fn((channel, listener) => {
      handlers.set(channel, listener)
    }),
    removeListener: vi.fn((channel, listener) => {
      if (handlers.get(channel) === listener) {
        handlers.delete(channel)
      }
    }),
  }
}

describe('ghostty render-state native package resolver', () => {
  test('prefers a package copied under the Electron app root', () => {
    withTempDir((appRoot) => {
      const packageRoot = nativePackageRootUnder(appRoot)
      createNativePackage(packageRoot)

      expect(resolveGhosttyNativePackageRoot(appRoot)).toBe(packageRoot)
    })
  })

  test('skips a partial app-root package without native payloads', () => {
    withTempDir((tempDir) => {
      const appRoot = path.join(tempDir, 'app')
      const packageRoot = nativePackageRootUnder(appRoot)
      const expectedPackageRoot = nativePackageRootUnder(tempDir)

      fs.mkdirSync(packageRoot, { recursive: true })
      fs.writeFileSync(path.join(packageRoot, 'package.json'), '{}')
      fs.mkdirSync(path.join(packageRoot, 'prebuilds'), { recursive: true })
      createNativePackage(expectedPackageRoot)

      expect(resolveGhosttyNativePackageRoot(appRoot)).toBe(expectedPackageRoot)
    })
  })

  test('falls back to Node resolution when the app root has no copied package', () => {
    withTempDir((tempDir) => {
      const appRoot = path.join(tempDir, 'app')
      const expectedPackageRoot = nativePackageRootUnder(tempDir)

      createNativePackage(expectedPackageRoot)

      expect(resolveGhosttyNativePackageRoot(appRoot)).toBe(expectedPackageRoot)
    })
  })
})

describe('ghostty render-state main bridge', () => {
  test('feeds bytes into the native terminal and normalizes snapshots', () => {
    const { bindings, terminals } = createNativeBindings()
    const bridge = new GhosttyRenderStateMainBridge('/app', bindings)
    const event = createEvent()
    const createResult = requireResult(bridge.createDriver(event))
    const bytes = new Uint8Array([0x68, 0x69])

    expect(
      bridge.writeBytes(event.sender.id, {
        driverId: createResult.driverId,
        bytes,
      })
    ).toEqual({
      ok: true,
      result: {
        events: [],
      },
    })

    expect(terminals[0]?.feed).toHaveBeenCalledWith(bytes)
    expect(
      bridge.readSnapshot(event.sender.id, { driverId: createResult.driverId })
    ).toEqual({
      ok: true,
      result: {
        rows: ['prompt', 'output', ...Array.from({ length: 22 }, () => '')],
        cursor: {
          rowIndex: 1,
          columnOffset: 2,
        },
        cells: [
          {
            row: 0,
            col: 0,
            text: 'p',
            width: 1,
            foreground: '#f38ba8',
            background: '#181825',
            bold: true,
          },
        ],
      },
    })

    expect(terminals[0]?.snapshot).toHaveBeenCalledWith({
      includeCells: true,
      includeScrollback: true,
    })
  })

  test('reports scrollbackRowCount from the native snapshot on the main screen', () => {
    const bindings: GhosttyNativeBindings = {
      createTerminal: () => ({
        feed: vi.fn(),
        resize: vi.fn(),
        snapshot: () => ({
          rows: 4,
          cursorRow: 0,
          cursorCol: 0,
          isAltScreen: false,
          visibleLines: [{ row: 0, text: 'prompt' }],
          scrollbackLines: [
            { row: 0, text: 'old line 1' },
            { row: 1, text: 'old line 2' },
            { row: 2, text: 'old line 3' },
          ],
        }),
        dispose: vi.fn(),
      }),
    }
    const bridge = new GhosttyRenderStateMainBridge('/app', bindings)
    const event = createEvent()
    const createResult = requireResult(bridge.createDriver(event))

    const snapshot = requireResult(
      bridge.readSnapshot(event.sender.id, { driverId: createResult.driverId })
    )

    expect(snapshot.scrollbackRowCount).toBe(3)
    expect(snapshot.isAltScreen).toBeUndefined()
  })

  test('suppresses scrollback on the alt screen (full-screen TUIs own scrolling)', () => {
    const bindings: GhosttyNativeBindings = {
      createTerminal: () => ({
        feed: vi.fn(),
        resize: vi.fn(),
        snapshot: () => ({
          rows: 4,
          cursorRow: 0,
          cursorCol: 0,
          isAltScreen: true,
          visibleLines: [{ row: 0, text: 'vim' }],
          scrollbackLines: [{ row: 0, text: 'stale history' }],
        }),
        dispose: vi.fn(),
      }),
    }
    const bridge = new GhosttyRenderStateMainBridge('/app', bindings)
    const event = createEvent()
    const createResult = requireResult(bridge.createDriver(event))

    const snapshot = requireResult(
      bridge.readSnapshot(event.sender.id, { driverId: createResult.driverId })
    )

    expect(snapshot.scrollbackRowCount).toBeUndefined() // 0 → omitted
    expect(snapshot.isAltScreen).toBe(true)
  })

  // Regression: codex's input composer is a full-width truecolor background bar
  // (rgb(57,57,71)) drawn over mostly-blank cells. libghostty's native snapshot
  // carries no color and omits blank cells, so the bar exists only in formatHtml.
  // The bridge must synthesize bg cells across the WHOLE row width from
  // formatHtml ranges — a transient "clamp to native content extent" once dropped
  // the blank portions and made the bar vanish (Ghostty terminal BUG-1). This
  // locks the synthesis so the regression can't return.
  test('synthesizes the background bar on the bar rows without bleeding onto the status row below (formatHtml wrapper offset)', () => {
    // formatHtml wraps every terminal row in an outer <div ...> whose opening
    // tag sits on its own line. The bar covers terminal rows 0-2 (blank /
    // composer / blank); a non-bg status line sits at row 3. If the synthesis
    // counts the wrapper's leading newline, every range shifts +1 and the bar
    // bleeds onto the status row.
    const bg = 'background-color: rgb(57, 57, 71)'

    const wrapperOpen =
      '<div style="font-family: monospace; white-space: pre;">'
    const barRow = `<div style="display: inline;${bg};">                    </div>`

    const composerRow =
      `<div style="display: inline;${bg};font-weight: bold;">&gt;</div>` +
      `<div style="display: inline;${bg};"> hi                </div>`

    const statusRow =
      '<div style="display: inline;color: rgb(241, 189, 69);">status</div></div>'
    const html = `${wrapperOpen}\n${[barRow, composerRow, barRow, statusRow].join('\n')}`

    // cspell:ignore truecolor
    const bindings: GhosttyNativeBindings = {
      createTerminal: () => ({
        feed: vi.fn(),
        resize: vi.fn(),
        snapshot: () => ({
          rows: 6,
          cursorRow: 1,
          cursorCol: 4,
          visibleLines: [
            { row: 0, text: '' },
            { row: 1, text: '> hi' },
            { row: 2, text: '' },
            { row: 3, text: 'status' },
          ],
          // native cells carry the bar bg on rows 0-2 (formatHtml keeps these
          // styled-blank rows, so there is no leading-empty trim); the status
          // row 3 is foreground-only.
          cells: [
            { row: 0, col: 0, text: ' ', width: 1, background: '#393947' },
            { row: 1, col: 0, text: '>', width: 1, background: '#393947' },
            { row: 1, col: 2, text: 'h', width: 1, background: '#393947' },
            { row: 1, col: 3, text: 'i', width: 1, background: '#393947' },
            { row: 2, col: 0, text: ' ', width: 1, background: '#393947' },
            { row: 3, col: 0, text: 's', width: 1, foreground: '#f1bd45' },
          ],
        }),
        formatHtml: () => html,
        dispose: vi.fn(),
      }),
    }

    const bridge = new GhosttyRenderStateMainBridge('/app', bindings)
    const event = createEvent()
    const createResult = requireResult(bridge.createDriver(event))

    const snapshot = requireResult(
      bridge.readSnapshot(event.sender.id, {
        driverId: createResult.driverId,
      })
    )
    const cells = snapshot.cells ?? []

    // bar rows 0,1,2 must be fully covered by the bar background
    for (const row of [0, 1, 2]) {
      for (let col = 0; col < 20; col += 1) {
        const covering = cells.find(
          (cell) =>
            cell.row === row && cell.col <= col && col < cell.col + cell.width
        )
        expect(covering?.background, `row ${row} col ${col}`).toBe('#393947')
      }
    }

    // the status row (3) must NOT receive the bar background (no bleed)
    expect(
      cells.some((cell) => cell.row === 3 && cell.background !== undefined)
    ).toBe(false)
  })

  test('keeps the bar on the prompt row when formatHtml trims a truly-empty leading row (shell)', () => {
    // A shell leaves row 0 truly empty (no text, no bg). formatHtml drops that
    // leading blank line, so its first content line is the prompt (native row
    // 1). The synthesis must add the trimmed leading-empty count back, or the
    // prompt bg lands one row too high on the empty row 0.
    const bg = 'background-color: rgb(57, 57, 71)'

    const wrapperOpen =
      '<div style="font-family: monospace; white-space: pre;">'
    const promptRow = `<div style="display: inline;${bg};">prompt $          </div></div>`
    // formatHtml omits the empty leading row entirely
    const html = `${wrapperOpen}\n${promptRow}`

    const bindings: GhosttyNativeBindings = {
      createTerminal: () => ({
        feed: vi.fn(),
        resize: vi.fn(),
        snapshot: () => ({
          rows: 5,
          cursorRow: 1,
          cursorCol: 8,
          visibleLines: [
            { row: 0, text: '' },
            { row: 1, text: 'prompt $' },
          ],
          cells: [
            { row: 1, col: 0, text: 'p', width: 1, background: '#393947' },
          ],
        }),
        formatHtml: () => html,
        dispose: vi.fn(),
      }),
    }

    const bridge = new GhosttyRenderStateMainBridge('/app', bindings)
    const event = createEvent()
    const createResult = requireResult(bridge.createDriver(event))

    const snapshot = requireResult(
      bridge.readSnapshot(event.sender.id, {
        driverId: createResult.driverId,
      })
    )
    const cells = snapshot.cells ?? []

    // the prompt bar must be on row 1, never on the empty leading row 0
    expect(
      cells.some((cell) => cell.row === 0 && cell.background !== undefined)
    ).toBe(false)

    expect(
      cells.some((cell) => cell.row === 1 && cell.background === '#393947')
    ).toBe(true)
  })

  test('anchors the bar to the visible viewport and drops scrollback bg rows (/resume, codex with history)', () => {
    // formatHtml carries the WHOLE terminal: scrollback (here two dimmed old
    // composer prompts) + the visible viewport. The native snapshot carries only
    // the 5-row viewport. With a fixed wrapper/leading offset the scrollback bar
    // rows mapped straight onto visible history rows (the /resume "Verified:" /
    // status bleed). The synthesis must anchor formatHtml's last content row to
    // the snapshot's last non-blank row and drop everything above the viewport.
    const bg = 'background-color: rgb(57, 57, 71)'
    const dim = `${bg};opacity: 0.5`

    const wrapperOpen =
      '<div style="font-family: monospace; white-space: pre;">'
    const barRow = `<div style="display: inline;${bg};">                    </div>`

    const composerRow =
      `<div style="display: inline;${bg};font-weight: bold;">&gt;</div>` +
      `<div style="display: inline;${bg};"> hi                </div>`

    const oldPrompt =
      `<div style="display: inline;${dim};font-weight: bold;">&gt;</div>` +
      `<div style="display: inline;${dim};"> old prompt         </div>`

    const plain = (text: string): string =>
      `<div style="display: inline;">${text}</div>`

    const statusRow =
      '<div style="display: inline;color: rgb(241, 189, 69);">status</div></div>'

    // 8 content rows: [0..2] scrollback (incl. a dimmed bar), then the visible
    // viewport [3..7] = old output / bar / composer / bar / status.
    const html = `${wrapperOpen}\n${[
      oldPrompt,
      plain('history line a'),
      plain('history line b'),
      plain('old output'),
      barRow,
      composerRow,
      barRow,
      statusRow,
    ].join('\n')}`

    const bindings: GhosttyNativeBindings = {
      createTerminal: () => ({
        feed: vi.fn(),
        resize: vi.fn(),
        snapshot: () => ({
          rows: 5,
          cursorRow: 2,
          cursorCol: 4,
          // visible viewport only — the bottom 5 rows of the grid
          visibleLines: [
            { row: 0, text: 'old output' },
            { row: 1, text: '' },
            { row: 2, text: '> hi' },
            { row: 3, text: '' },
            { row: 4, text: 'status' },
          ],
          cells: [
            { row: 1, col: 0, text: ' ', width: 1, background: '#393947' },
            { row: 2, col: 0, text: '>', width: 1, background: '#393947' },
            { row: 2, col: 2, text: 'h', width: 1, background: '#393947' },
            { row: 2, col: 3, text: 'i', width: 1, background: '#393947' },
            { row: 3, col: 0, text: ' ', width: 1, background: '#393947' },
            { row: 4, col: 0, text: 's', width: 1, foreground: '#f1bd45' },
          ],
        }),
        formatHtml: () => html,
        dispose: vi.fn(),
      }),
    }

    const bridge = new GhosttyRenderStateMainBridge('/app', bindings)
    const event = createEvent()
    const createResult = requireResult(bridge.createDriver(event))

    const snapshot = requireResult(
      bridge.readSnapshot(event.sender.id, {
        driverId: createResult.driverId,
      })
    )
    const cells = snapshot.cells ?? []

    // bar rows 1,2,3 fully covered by the bar background
    for (const row of [1, 2, 3]) {
      for (let col = 0; col < 20; col += 1) {
        const covering = cells.find(
          (cell) =>
            cell.row === row && cell.col <= col && col < cell.col + cell.width
        )
        expect(covering?.background, `row ${row} col ${col}`).toBe('#393947')
      }
    }

    // visible history row 0 ('old output') and the status row 4 must stay clean —
    // the scrollback's dimmed prompt bg must NOT bleed onto them
    expect(
      cells.some((cell) => cell.row === 0 && cell.background !== undefined)
    ).toBe(false)

    expect(
      cells.some((cell) => cell.row === 4 && cell.background !== undefined)
    ).toBe(false)
  })

  test('anchors to a trailing styled-blank bar row without a status row below it', () => {
    const bg = 'background-color: rgb(57, 57, 71)'

    const wrapperOpen =
      '<div style="font-family: monospace; white-space: pre;">'

    const barRow = `<div style="display: inline;${bg};">                    </div>`

    const composerRow =
      `<div style="display: inline;${bg};font-weight: bold;">&gt;</div>` +
      `<div style="display: inline;${bg};"> hi                </div></div>`
    const html = `${wrapperOpen}\n${[barRow, composerRow, barRow].join('\n')}`

    const bindings: GhosttyNativeBindings = {
      createTerminal: () => ({
        feed: vi.fn(),
        resize: vi.fn(),
        snapshot: () => ({
          rows: 3,
          cursorRow: 1,
          cursorCol: 4,
          visibleLines: [
            { row: 0, text: '' },
            { row: 1, text: '> hi' },
            { row: 2, text: '' },
          ],
          cells: [
            { row: 0, col: 0, text: ' ', width: 1, background: '#393947' },
            { row: 1, col: 0, text: '>', width: 1, background: '#393947' },
            { row: 1, col: 2, text: 'h', width: 1, background: '#393947' },
            { row: 1, col: 3, text: 'i', width: 1, background: '#393947' },
            { row: 2, col: 0, text: ' ', width: 1, background: '#393947' },
          ],
        }),
        formatHtml: () => html,
        dispose: vi.fn(),
      }),
    }

    const bridge = new GhosttyRenderStateMainBridge('/app', bindings)
    const event = createEvent()
    const createResult = requireResult(bridge.createDriver(event))

    const snapshot = requireResult(
      bridge.readSnapshot(event.sender.id, {
        driverId: createResult.driverId,
      })
    )
    const cells = snapshot.cells ?? []

    for (const row of [0, 1, 2]) {
      for (let col = 0; col < 20; col += 1) {
        const covering = cells.find(
          (cell) =>
            cell.row === row && cell.col <= col && col < cell.col + cell.width
        )
        expect(covering?.background, `row ${row} col ${col}`).toBe('#393947')
      }
    }
  })

  test('drops formatter ranges when a blank native viewport has no content anchor', () => {
    const bg = 'background-color: rgb(57, 57, 71)'

    const wrapperOpen =
      '<div style="font-family: monospace; white-space: pre;">'
    const barRow = `<div style="display: inline;${bg};">                    </div>`
    const html = `${wrapperOpen}\n${[barRow, 'old scrollback'].join('\n')}</div>`

    const bindings: GhosttyNativeBindings = {
      createTerminal: () => ({
        feed: vi.fn(),
        resize: vi.fn(),
        snapshot: () => ({
          rows: 3,
          cursorRow: 0,
          cursorCol: 0,
          visibleLines: [
            { row: 0, text: '' },
            { row: 1, text: '' },
            { row: 2, text: '' },
          ],
          cells: [],
        }),
        formatHtml: () => html,
        dispose: vi.fn(),
      }),
    }

    const bridge = new GhosttyRenderStateMainBridge('/app', bindings)
    const event = createEvent()
    const createResult = requireResult(bridge.createDriver(event))

    const snapshot = requireResult(
      bridge.readSnapshot(event.sender.id, {
        driverId: createResult.driverId,
      })
    )

    expect(snapshot.cells).toBeUndefined()
  })

  test('returns OSC7 cwd effects across byte chunks before feeding native state', () => {
    const { bindings, terminals } = createNativeBindings()
    const bridge = new GhosttyRenderStateMainBridge('/app', bindings)
    const event = createEvent()
    const createResult = requireResult(bridge.createDriver(event))
    const encoder = new TextEncoder()

    expect(
      bridge.writeBytes(event.sender.id, {
        driverId: createResult.driverId,
        bytes: encoder.encode('\u001b]7;file://localhost/Users'),
      })
    ).toEqual({
      ok: true,
      result: {
        events: [],
      },
    })

    expect(
      bridge.writeBytes(event.sender.id, {
        driverId: createResult.driverId,
        bytes: encoder.encode('/user/project\u0007prompt'),
      })
    ).toEqual({
      ok: true,
      result: {
        events: [
          {
            type: 'cwd',
            uri: 'file://localhost/Users/user/project',
          },
        ],
      },
    })
    expect(terminals[0]?.feed).toHaveBeenCalledTimes(2)
  })

  test('tracks hidden cursor mode across byte chunks', () => {
    const { bindings } = createNativeBindings()
    const bridge = new GhosttyRenderStateMainBridge('/app', bindings)
    const event = createEvent()
    const createResult = requireResult(bridge.createDriver(event))
    const encoder = new TextEncoder()

    expect(
      bridge.writeBytes(event.sender.id, {
        driverId: createResult.driverId,
        bytes: encoder.encode('\u001b[?2'),
      })
    ).toEqual({
      ok: true,
      result: {
        events: [],
      },
    })

    expect(
      bridge.writeBytes(event.sender.id, {
        driverId: createResult.driverId,
        bytes: encoder.encode('5lSelect permission mode'),
      })
    ).toEqual({
      ok: true,
      result: {
        events: [],
      },
    })

    expect(
      bridge.readSnapshot(event.sender.id, { driverId: createResult.driverId })
    ).toMatchObject({
      ok: true,
      result: {
        cursor: {
          rowIndex: 1,
          columnOffset: 2,
          visible: false,
        },
      },
    })

    expect(
      bridge.writeBytes(event.sender.id, {
        driverId: createResult.driverId,
        bytes: encoder.encode('\u001b[?25:1h'),
      })
    ).toEqual({
      ok: true,
      result: {
        events: [],
      },
    })

    expect(
      bridge.readSnapshot(event.sender.id, { driverId: createResult.driverId })
    ).toMatchObject({
      ok: true,
      result: {
        cursor: {
          rowIndex: 1,
          columnOffset: 2,
        },
      },
    })

    expect(
      requireResult(
        bridge.readSnapshot(event.sender.id, {
          driverId: createResult.driverId,
        })
      ).cursor
    ).not.toHaveProperty('visible')

    expect(
      bridge.writeBytes(event.sender.id, {
        driverId: createResult.driverId,
        bytes: encoder.encode('\u001b[?25:1l'),
      })
    ).toEqual({
      ok: true,
      result: {
        events: [],
      },
    })

    expect(
      bridge.readSnapshot(event.sender.id, { driverId: createResult.driverId })
    ).toMatchObject({
      ok: true,
      result: {
        cursor: {
          visible: false,
        },
      },
    })
  })

  test('drops oversized complete OSC7 cwd effects', () => {
    const { bindings, terminals } = createNativeBindings()
    const bridge = new GhosttyRenderStateMainBridge('/app', bindings)
    const event = createEvent()
    const createResult = requireResult(bridge.createDriver(event))
    const encoder = new TextEncoder()

    expect(
      bridge.writeBytes(event.sender.id, {
        driverId: createResult.driverId,
        bytes: encoder.encode(`\u001b]7;${'x'.repeat(8193)}\u0007prompt`),
      })
    ).toEqual({
      ok: true,
      result: {
        events: [],
      },
    })
    expect(terminals[0]?.feed).toHaveBeenCalledOnce()
  })

  test('drops oversized pending private CSI cursor visibility sequences', () => {
    const { bindings } = createNativeBindings()
    const bridge = new GhosttyRenderStateMainBridge('/app', bindings)
    const event = createEvent()
    const createResult = requireResult(bridge.createDriver(event))
    const encoder = new TextEncoder()

    expect(
      bridge.writeBytes(event.sender.id, {
        driverId: createResult.driverId,
        bytes: encoder.encode(`\u001b[?${'1'.repeat(8193)}`),
      })
    ).toEqual({
      ok: true,
      result: {
        events: [],
      },
    })

    expect(
      bridge.writeBytes(event.sender.id, {
        driverId: createResult.driverId,
        bytes: encoder.encode('25l'),
      })
    ).toEqual({
      ok: true,
      result: {
        events: [],
      },
    })

    expect(
      requireResult(
        bridge.readSnapshot(event.sender.id, {
          driverId: createResult.driverId,
        })
      ).cursor
    ).not.toHaveProperty('visible')
  })

  test('resizes native state and resets by recreating the terminal at the current size', () => {
    const { bindings, terminals } = createNativeBindings()
    const bridge = new GhosttyRenderStateMainBridge('/app', bindings)
    const event = createEvent()
    const createResult = requireResult(bridge.createDriver(event))

    expect(
      bridge.resize(event.sender.id, {
        driverId: createResult.driverId,
        size: { cols: 120, rows: 32 },
      })
    ).toEqual({ ok: true, result: null })

    expect(
      bridge.reset(event.sender.id, { driverId: createResult.driverId })
    ).toEqual({
      ok: true,
      result: null,
    })

    expect(terminals[0]?.resize).toHaveBeenCalledWith(120, 32)
    expect(terminals[0]?.dispose).toHaveBeenCalledOnce()
    expect(bindings.createTerminal).toHaveBeenLastCalledWith({
      cols: 120,
      rows: 32,
      scrollbackLimit: 10_000,
    })
    expect(terminals).toHaveLength(2)
  })

  test('keeps the cached size unchanged when native resize fails', () => {
    const { bindings, terminals } = createNativeBindings()
    const bridge = new GhosttyRenderStateMainBridge('/app', bindings)
    const event = createEvent()
    const createResult = requireResult(bridge.createDriver(event))

    terminals[0]?.resize.mockImplementationOnce(() => {
      throw new Error('native resize failed')
    })

    expect(
      bridge.resize(event.sender.id, {
        driverId: createResult.driverId,
        size: { cols: 120, rows: 32 },
      })
    ).toEqual({
      ok: false,
      error: 'native resize failed',
    })

    expect(
      bridge.reset(event.sender.id, { driverId: createResult.driverId })
    ).toEqual({
      ok: true,
      result: null,
    })

    expect(bindings.createTerminal).toHaveBeenLastCalledWith({
      cols: 80,
      rows: 24,
      scrollbackLimit: 10_000,
    })
  })

  test('keeps the existing terminal when reset recreation fails', () => {
    const { bindings, terminals } = createNativeBindings()
    const bridge = new GhosttyRenderStateMainBridge('/app', bindings)
    const event = createEvent()
    const createResult = requireResult(bridge.createDriver(event))

    vi.mocked(bindings.createTerminal).mockImplementationOnce(() => {
      throw new Error('native allocation failed')
    })

    expect(
      bridge.reset(event.sender.id, { driverId: createResult.driverId })
    ).toEqual({
      ok: false,
      error: 'native allocation failed',
    })
    expect(terminals[0]?.dispose).not.toHaveBeenCalled()

    expect(
      bridge.writeBytes(event.sender.id, {
        driverId: createResult.driverId,
        bytes: new Uint8Array([0x68]),
      })
    ).toEqual({
      ok: true,
      result: {
        events: [],
      },
    })
    expect(terminals[0]?.feed).toHaveBeenCalledWith(new Uint8Array([0x68]))
  })

  test('keeps the replacement terminal active when old reset disposal fails', () => {
    const { bindings, terminals } = createNativeBindings()
    const bridge = new GhosttyRenderStateMainBridge('/app', bindings)
    const event = createEvent()
    const createResult = requireResult(bridge.createDriver(event))

    terminals[0]?.dispose.mockImplementationOnce(() => {
      throw new Error('native dispose failed')
    })

    expect(
      bridge.reset(event.sender.id, { driverId: createResult.driverId })
    ).toEqual({
      ok: false,
      error: 'native dispose failed',
    })

    expect(
      bridge.writeBytes(event.sender.id, {
        driverId: createResult.driverId,
        bytes: new Uint8Array([0x68]),
      })
    ).toEqual({
      ok: true,
      result: {
        events: [],
      },
    })
    expect(terminals[1]?.feed).toHaveBeenCalledWith(new Uint8Array([0x68]))
    expect(terminals[1]?.dispose).not.toHaveBeenCalled()
  })

  test('preserves fallback row text around sparse styled cells by cell columns', () => {
    const bridge = new GhosttyRenderStateMainBridge('/app', {
      createTerminal: (): ReturnType<
        GhosttyNativeBindings['createTerminal']
      > => ({
        feed: vi.fn(),
        resize: vi.fn(),
        snapshot: () => ({
          rows: 1,
          cursorRow: 0,
          cursorCol: 6,
          visibleLines: [{ row: 0, text: '界red$' }],
          cells: [
            {
              row: 0,
              col: 2,
              text: 'red',
              width: 3,
              foreground: '#f38ba8',
            },
            {
              row: 0,
              col: 5,
              text: '',
              width: 1,
            },
          ],
        }),
        dispose: vi.fn(),
      }),
    })
    const event = createEvent()
    const createResult = requireResult(bridge.createDriver(event))

    expect(
      bridge.readSnapshot(event.sender.id, { driverId: createResult.driverId })
    ).toEqual({
      ok: true,
      result: {
        rows: ['界red$'],
        cursor: {
          rowIndex: 0,
          columnOffset: 6,
        },
        cells: [
          {
            row: 0,
            col: 2,
            text: 'red',
            width: 3,
            foreground: '#f38ba8',
          },
          {
            row: 0,
            col: 5,
            text: '',
            width: 1,
          },
        ],
      },
    })
  })

  test('leaves native sparse styled cells for renderer-side normalization', () => {
    const bridge = new GhosttyRenderStateMainBridge('/app', {
      createTerminal: (): ReturnType<
        GhosttyNativeBindings['createTerminal']
      > => ({
        feed: vi.fn(),
        resize: vi.fn(),
        snapshot: () => ({
          rows: 1,
          cursorRow: 0,
          cursorCol: 3,
          visibleLines: [{ row: 0, text: 'AB' }],
          cells: [
            {
              row: 0,
              col: 0,
              text: 'A',
              width: 1,
            },
            {
              row: 0,
              col: 1,
              text: '',
              width: 1,
              background: '#181825',
            },
            {
              row: 0,
              col: 2,
              text: 'B',
              width: 1,
            },
          ],
        }),
        dispose: vi.fn(),
      }),
    })
    const event = createEvent()
    const createResult = requireResult(bridge.createDriver(event))

    expect(
      bridge.readSnapshot(event.sender.id, { driverId: createResult.driverId })
    ).toEqual({
      ok: true,
      result: {
        rows: ['AB'],
        cursor: {
          rowIndex: 0,
          columnOffset: 3,
        },
        cells: [
          {
            row: 0,
            col: 0,
            text: 'A',
            width: 1,
          },
          {
            row: 0,
            col: 1,
            text: '',
            width: 1,
            background: '#181825',
          },
          {
            row: 0,
            col: 2,
            text: 'B',
            width: 1,
          },
        ],
      },
    })
  })

  test('marks reverse-video formatter ranges on native cells', () => {
    const bridge = new GhosttyRenderStateMainBridge('/app', {
      createTerminal: (): ReturnType<
        GhosttyNativeBindings['createTerminal']
      > => ({
        feed: vi.fn(),
        resize: vi.fn(),
        snapshot: () => ({
          rows: 1,
          cursorRow: 0,
          cursorCol: 25,
          visibleLines: [{ row: 0, text: ' Explain this codebase' }],
          cells: [
            {
              row: 0,
              col: 0,
              text: ' Explain this codebase   ',
              width: 25,
            },
          ],
        }),
        formatHtml: vi.fn(
          () =>
            '<div style="font-family: monospace; white-space: pre;"><div style="display: inline;filter: invert(100%);"> Explain this codebase   </div></div>'
        ),
        dispose: vi.fn(),
      }),
    })
    const event = createEvent()
    const createResult = requireResult(bridge.createDriver(event))

    expect(
      bridge.readSnapshot(event.sender.id, { driverId: createResult.driverId })
    ).toEqual({
      ok: true,
      result: {
        rows: [' Explain this codebase'],
        cursor: {
          rowIndex: 0,
          columnOffset: 25,
        },
        cells: [
          {
            row: 0,
            col: 0,
            text: ' Explain this codebase   ',
            width: 25,
            reverse: true,
          },
        ],
      },
    })
  })

  test('splits native cells at partial reverse-video formatter ranges', () => {
    const bridge = new GhosttyRenderStateMainBridge('/app', {
      createTerminal: (): ReturnType<
        GhosttyNativeBindings['createTerminal']
      > => ({
        feed: vi.fn(),
        resize: vi.fn(),
        snapshot: () => ({
          rows: 1,
          cursorRow: 0,
          cursorCol: 10,
          visibleLines: [{ row: 0, text: 'abcde' }],
          cells: [
            {
              row: 0,
              col: 0,
              text: 'abcde',
              width: 5,
            },
          ],
        }),
        formatHtml: vi.fn(
          () =>
            '<div style="font-family: monospace; white-space: pre;">ab<span style="display: inline;filter: invert(100%);">cd</span>e</div>'
        ),
        dispose: vi.fn(),
      }),
    })
    const event = createEvent()
    const createResult = requireResult(bridge.createDriver(event))

    expect(
      bridge.readSnapshot(event.sender.id, { driverId: createResult.driverId })
    ).toEqual({
      ok: true,
      result: {
        rows: ['abcde'],
        cursor: {
          rowIndex: 0,
          columnOffset: 10,
        },
        cells: [
          {
            row: 0,
            col: 0,
            text: 'ab',
            width: 2,
          },
          {
            row: 0,
            col: 2,
            text: 'cd',
            width: 2,
            reverse: true,
          },
          {
            row: 0,
            col: 4,
            text: 'e',
            width: 1,
          },
        ],
      },
    })
  })

  test('creates reverse-video cells when formatter ranges have no native cells', () => {
    const bridge = new GhosttyRenderStateMainBridge('/app', {
      createTerminal: (): ReturnType<
        GhosttyNativeBindings['createTerminal']
      > => ({
        feed: vi.fn(),
        resize: vi.fn(),
        snapshot: () => ({
          rows: 1,
          cursorRow: 0,
          cursorCol: 24,
          visibleLines: [{ row: 0, text: '> Explain this codebase ' }],
        }),
        formatHtml: vi.fn(
          () =>
            '<div style="font-family: monospace; white-space: pre;"><div style="display: inline;filter: invert(100%);">&gt; Explain this codebase </div></div>'
        ),
        dispose: vi.fn(),
      }),
    })
    const event = createEvent()
    const createResult = requireResult(bridge.createDriver(event))

    expect(
      bridge.readSnapshot(event.sender.id, { driverId: createResult.driverId })
    ).toEqual({
      ok: true,
      result: {
        rows: ['> Explain this codebase '],
        cursor: {
          rowIndex: 0,
          columnOffset: 24,
        },
        cells: [
          {
            row: 0,
            col: 0,
            text: '> Explain this codebase ',
            width: 24,
            reverse: true,
          },
        ],
      },
    })
  })

  test('tracks non-div formatter tags while reading reverse-video columns', () => {
    const bridge = new GhosttyRenderStateMainBridge('/app', {
      createTerminal: (): ReturnType<
        GhosttyNativeBindings['createTerminal']
      > => ({
        feed: vi.fn(),
        resize: vi.fn(),
        snapshot: () => ({
          rows: 1,
          cursorRow: 0,
          cursorCol: 3,
          visibleLines: [{ row: 0, text: 'abc' }],
        }),
        formatHtml: vi.fn(
          () =>
            '<div style="font-family: monospace; white-space: pre;">a<span style="display: inline;filter: invert(100%);">bc</span></div>'
        ),
        dispose: vi.fn(),
      }),
    })
    const event = createEvent()
    const createResult = requireResult(bridge.createDriver(event))

    expect(
      bridge.readSnapshot(event.sender.id, { driverId: createResult.driverId })
    ).toEqual({
      ok: true,
      result: {
        rows: ['abc'],
        cursor: {
          rowIndex: 0,
          columnOffset: 3,
        },
        cells: [
          {
            row: 0,
            col: 1,
            text: 'bc',
            width: 2,
            reverse: true,
          },
        ],
      },
    })
  })

  test('creates background cells when formatter ranges have no native cells', () => {
    const bridge = new GhosttyRenderStateMainBridge('/app', {
      createTerminal: (): ReturnType<
        GhosttyNativeBindings['createTerminal']
      > => ({
        feed: vi.fn(),
        resize: vi.fn(),
        snapshot: () => ({
          rows: 1,
          cursorRow: 0,
          cursorCol: 24,
          visibleLines: [{ row: 0, text: '> Explain this codebase ' }],
        }),
        formatHtml: vi.fn(
          () =>
            '<div style="font-family: monospace; white-space: pre;"><span style="background-color: rgb(64, 64, 72);">&gt; Explain this codebase </span></div>'
        ),
        dispose: vi.fn(),
      }),
    })
    const event = createEvent()
    const createResult = requireResult(bridge.createDriver(event))

    expect(
      bridge.readSnapshot(event.sender.id, { driverId: createResult.driverId })
    ).toEqual({
      ok: true,
      result: {
        rows: ['> Explain this codebase '],
        cursor: {
          rowIndex: 0,
          columnOffset: 24,
        },
        cells: [
          {
            row: 0,
            col: 0,
            text: '> Explain this codebase ',
            width: 24,
            background: '#404048',
          },
        ],
      },
    })
  })

  test('renders a palette (var--vt-palette) background box across blank cells the snapshot omits', () => {
    const bridge = new GhosttyRenderStateMainBridge('/app', {
      createTerminal: (): ReturnType<
        GhosttyNativeBindings['createTerminal']
      > => ({
        feed: vi.fn(),
        resize: vi.fn(),
        snapshot: () => ({
          rows: 1,
          cursorRow: 0,
          cursorCol: 3,
          visibleLines: [{ row: 0, text: ' ab' }],
        }),
        formatHtml: vi.fn(
          () =>
            '<div style="font-family: monospace; white-space: pre;"><div style="display: inline;background-color: var(--vt-palette-236);"> ab   </div></div>'
        ),
        dispose: vi.fn(),
      }),
    })
    const event = createEvent()
    const createResult = requireResult(bridge.createDriver(event))

    expect(
      bridge.readSnapshot(event.sender.id, { driverId: createResult.driverId })
    ).toEqual({
      ok: true,
      result: {
        rows: [' ab'],
        cursor: {
          rowIndex: 0,
          columnOffset: 3,
        },
        cells: [
          { row: 0, col: 0, text: ' ab   ', width: 6, background: '#303030' },
        ],
      },
    })
  })

  test('decodes numeric glyph entities so background ranges align to native columns', () => {
    const separator = String.fromCodePoint(0xe0b0)

    const bridge = new GhosttyRenderStateMainBridge('/app', {
      createTerminal: (): ReturnType<
        GhosttyNativeBindings['createTerminal']
      > => ({
        feed: vi.fn(),
        resize: vi.fn(),
        snapshot: () => ({
          rows: 1,
          cursorRow: 0,
          cursorCol: 3,
          visibleLines: [{ row: 0, text: `${separator}ab` }],
          cells: [
            { row: 0, col: 0, text: separator, width: 1 },
            { row: 0, col: 1, text: 'a', width: 1 },
            { row: 0, col: 2, text: 'b', width: 1 },
          ],
        }),
        formatHtml: vi.fn(
          () =>
            '<div style="font-family: monospace; white-space: pre;"><div style="display: inline;color: rgb(1, 2, 3);">&#57520;</div><div style="display: inline;background-color: rgb(64, 64, 72);">ab</div></div>'
        ),
        dispose: vi.fn(),
      }),
    })
    const event = createEvent()
    const createResult = requireResult(bridge.createDriver(event))

    expect(
      bridge.readSnapshot(event.sender.id, { driverId: createResult.driverId })
    ).toEqual({
      ok: true,
      result: {
        rows: [`${separator}ab`],
        cursor: {
          rowIndex: 0,
          columnOffset: 3,
        },
        cells: [
          { row: 0, col: 0, text: separator, width: 1 },
          { row: 0, col: 1, text: 'a', width: 1, background: '#404048' },
          { row: 0, col: 2, text: 'b', width: 1, background: '#404048' },
        ],
      },
    })
  })

  test('decodes uppercase hex numeric glyph entities', () => {
    const separator = String.fromCodePoint(0xe0b0)

    const bridge = new GhosttyRenderStateMainBridge('/app', {
      createTerminal: (): ReturnType<
        GhosttyNativeBindings['createTerminal']
      > => ({
        feed: vi.fn(),
        resize: vi.fn(),
        snapshot: () => ({
          rows: 1,
          cursorRow: 0,
          cursorCol: 2,
          visibleLines: [{ row: 0, text: `${separator}x` }],
          cells: [
            { row: 0, col: 0, text: separator, width: 1 },
            { row: 0, col: 1, text: 'x', width: 1 },
          ],
        }),
        formatHtml: vi.fn(
          () =>
            '<div style="font-family: monospace; white-space: pre;"><span>&#XE0B0;</span><span style="background-color: rgb(64, 64, 72);">x</span></div>'
        ),
        dispose: vi.fn(),
      }),
    })
    const event = createEvent()
    const createResult = requireResult(bridge.createDriver(event))

    expect(
      bridge.readSnapshot(event.sender.id, { driverId: createResult.driverId })
    ).toEqual({
      ok: true,
      result: {
        rows: [`${separator}x`],
        cursor: {
          rowIndex: 0,
          columnOffset: 2,
        },
        cells: [
          { row: 0, col: 0, text: separator, width: 1 },
          { row: 0, col: 1, text: 'x', width: 1, background: '#404048' },
        ],
      },
    })
  })

  test('preserves native fallback text before sparse styled empty cells', () => {
    const bridge = new GhosttyRenderStateMainBridge('/app', {
      createTerminal: (): ReturnType<
        GhosttyNativeBindings['createTerminal']
      > => ({
        feed: vi.fn(),
        resize: vi.fn(),
        snapshot: () => ({
          rows: 1,
          cursorRow: 0,
          cursorCol: 3,
          visibleLines: [{ row: 0, text: 'AB' }],
          cells: [
            {
              row: 0,
              col: 1,
              text: '',
              width: 1,
              background: '#181825',
            },
          ],
        }),
        dispose: vi.fn(),
      }),
    })
    const event = createEvent()
    const createResult = requireResult(bridge.createDriver(event))

    expect(
      bridge.readSnapshot(event.sender.id, { driverId: createResult.driverId })
    ).toEqual({
      ok: true,
      result: {
        rows: ['AB'],
        cursor: {
          rowIndex: 0,
          columnOffset: 3,
        },
        cells: [
          {
            row: 0,
            col: 1,
            text: '',
            width: 1,
            background: '#181825',
          },
        ],
      },
    })
  })

  test('skips overlapping empty cells after native wide glyph cells', () => {
    const icon = '\uf120'

    const bridge = new GhosttyRenderStateMainBridge('/app', {
      createTerminal: (): ReturnType<
        GhosttyNativeBindings['createTerminal']
      > => ({
        feed: vi.fn(),
        resize: vi.fn(),
        snapshot: () => ({
          rows: 1,
          cursorRow: 0,
          cursorCol: 3,
          visibleLines: [{ row: 0, text: `${icon}x` }],
          cells: [
            {
              row: 0,
              col: 0,
              text: icon,
              width: 2,
              foreground: '#f38ba8',
            },
            {
              row: 0,
              col: 1,
              text: '',
              width: 1,
            },
            {
              row: 0,
              col: 2,
              text: 'x',
              width: 1,
            },
          ],
        }),
        dispose: vi.fn(),
      }),
    })
    const event = createEvent()
    const createResult = requireResult(bridge.createDriver(event))

    expect(
      bridge.readSnapshot(event.sender.id, { driverId: createResult.driverId })
    ).toEqual({
      ok: true,
      result: {
        rows: [`${icon}x`],
        cursor: {
          rowIndex: 0,
          columnOffset: 3,
        },
        cells: [
          {
            row: 0,
            col: 0,
            text: icon,
            width: 2,
            foreground: '#f38ba8',
          },
          {
            row: 0,
            col: 1,
            text: '',
            width: 1,
          },
          {
            row: 0,
            col: 2,
            text: 'x',
            width: 1,
          },
        ],
      },
    })
  })

  test('keeps combining marks with fallback text before sparse styled cells', () => {
    const bridge = new GhosttyRenderStateMainBridge('/app', {
      createTerminal: (): ReturnType<
        GhosttyNativeBindings['createTerminal']
      > => ({
        feed: vi.fn(),
        resize: vi.fn(),
        snapshot: () => ({
          rows: 1,
          cursorRow: 0,
          cursorCol: 4,
          visibleLines: [{ row: 0, text: 'e\u0301red' }],
          cells: [
            {
              row: 0,
              col: 1,
              text: 'red',
              width: 3,
              foreground: '#f38ba8',
            },
          ],
        }),
        dispose: vi.fn(),
      }),
    })
    const event = createEvent()
    const createResult = requireResult(bridge.createDriver(event))

    expect(
      bridge.readSnapshot(event.sender.id, { driverId: createResult.driverId })
    ).toEqual({
      ok: true,
      result: {
        rows: ['e\u0301red'],
        cursor: {
          rowIndex: 0,
          columnOffset: 4,
        },
        cells: [
          {
            row: 0,
            col: 1,
            text: 'red',
            width: 3,
            foreground: '#f38ba8',
          },
        ],
      },
    })
  })

  test('keeps variation selectors with fallback text before sparse styled cells', () => {
    const bridge = new GhosttyRenderStateMainBridge('/app', {
      createTerminal: (): ReturnType<
        GhosttyNativeBindings['createTerminal']
      > => ({
        feed: vi.fn(),
        resize: vi.fn(),
        snapshot: () => ({
          rows: 1,
          cursorRow: 0,
          cursorCol: 4,
          visibleLines: [{ row: 0, text: 'a\ufe0fred' }],
          cells: [
            {
              row: 0,
              col: 1,
              text: 'red',
              width: 3,
              foreground: '#f38ba8',
            },
          ],
        }),
        dispose: vi.fn(),
      }),
    })
    const event = createEvent()
    const createResult = requireResult(bridge.createDriver(event))

    expect(
      bridge.readSnapshot(event.sender.id, { driverId: createResult.driverId })
    ).toEqual({
      ok: true,
      result: {
        rows: ['a\ufe0fred'],
        cursor: {
          rowIndex: 0,
          columnOffset: 4,
        },
        cells: [
          {
            row: 0,
            col: 1,
            text: 'red',
            width: 3,
            foreground: '#f38ba8',
          },
        ],
      },
    })
  })

  test('rejects oversized native terminal dimensions before resize', () => {
    const { bindings, terminals } = createNativeBindings()
    const bridge = new GhosttyRenderStateMainBridge('/app', bindings)
    const event = createEvent()
    const createResult = requireResult(bridge.createDriver(event))

    expect(
      bridge.resize(event.sender.id, {
        driverId: createResult.driverId,
        size: { cols: 1001, rows: 24 },
      })
    ).toEqual({
      ok: false,
      error: 'Ghostty native render-state size is invalid',
    })
    expect(terminals[0]?.resize).not.toHaveBeenCalled()
  })

  test('returns ipc failures when cached native callback throws', () => {
    const bridge = new GhosttyRenderStateMainBridge('/app', {
      createTerminal: (): ReturnType<
        GhosttyNativeBindings['createTerminal']
      > => {
        throw new Error('native create failed')
      },
    })

    expect(bridge.createDriver(createEvent())).toEqual({
      ok: false,
      error: 'native create failed',
    })
  })

  test('removes the web contents destroyed listener when disposing a driver', () => {
    const { bindings, terminals } = createNativeBindings()
    const bridge = new GhosttyRenderStateMainBridge('/app', bindings)
    const event = createEvent()
    const createResult = requireResult(bridge.createDriver(event))
    const once = event.sender.once

    if (!once) {
      throw new Error('Expected test event to support destroyed listeners')
    }

    const listener = vi.mocked(once).mock.calls[0]?.[1]

    expect(listener).toBeDefined()

    expect(
      bridge.dispose(event.sender.id, { driverId: createResult.driverId })
    ).toEqual({
      ok: true,
      result: null,
    })

    expect(event.sender.removeListener).toHaveBeenCalledWith(
      'destroyed',
      listener
    )
    expect(terminals[0]?.dispose).toHaveBeenCalledOnce()
  })

  test('rejects invalid native snapshots at the bridge boundary', () => {
    const bridge = new GhosttyRenderStateMainBridge('/app', {
      createTerminal: (): ReturnType<
        GhosttyNativeBindings['createTerminal']
      > => ({
        feed: vi.fn(),
        resize: vi.fn(),
        snapshot: (): {
          rows: number
          cursorRow: number
          cursorCol: number
          visibleLines: readonly { row: number; text: string }[]
        } => ({
          rows: 1,
          cursorRow: 0,
          cursorCol: 0,
          visibleLines: [{ row: 4, text: 'outside viewport' }],
        }),
        dispose: vi.fn(),
      }),
    })
    const event = createEvent()
    const createResult = requireResult(bridge.createDriver(event))

    expect(
      bridge.readSnapshot(event.sender.id, { driverId: createResult.driverId })
    ).toEqual({
      ok: false,
      error: 'Ghostty native render-state snapshot rows are invalid',
    })
  })

  test('installs and removes synchronous IPC handlers', () => {
    const { bindings } = createNativeBindings()
    const ipcMain = createIpcMain()

    const dispose = setupGhosttyRenderStateIpc({
      appRoot: '/app',
      ipcMain,
      nativeBindings: bindings,
    })
    const event = createEvent()

    ipcMain.handlers.get(GHOSTTY_RENDER_STATE_STATUS)?.(event)
    expect(event.returnValue).toEqual({ ok: true, result: null })

    ipcMain.handlers.get(GHOSTTY_RENDER_STATE_CREATE)?.(event)

    const createResult = event.returnValue as {
      ok: true
      result: { driverId: string }
    }
    ipcMain.handlers.get(GHOSTTY_RENDER_STATE_WRITE_BYTES)?.(event, {
      driverId: createResult.result.driverId,
      bytes: new Uint8Array([0x68]),
    })

    expect(event.returnValue).toEqual({
      ok: true,
      result: {
        events: [],
      },
    })

    ipcMain.handlers.get(GHOSTTY_RENDER_STATE_READ_SNAPSHOT)?.(event, {
      driverId: createResult.result.driverId,
    })

    expect(event.returnValue).toEqual(expect.objectContaining({ ok: true }))

    ipcMain.handlers.get(GHOSTTY_RENDER_STATE_RESIZE)?.(event, {
      driverId: createResult.result.driverId,
      size: { cols: 100, rows: 30 },
    })
    expect(event.returnValue).toEqual({ ok: true, result: null })
    ipcMain.handlers.get(GHOSTTY_RENDER_STATE_RESET)?.(event, {
      driverId: createResult.result.driverId,
    })
    expect(event.returnValue).toEqual({ ok: true, result: null })
    ipcMain.handlers.get(GHOSTTY_RENDER_STATE_DISPOSE)?.(event, {
      driverId: createResult.result.driverId,
    })
    expect(event.returnValue).toEqual({ ok: true, result: null })

    dispose()

    expect(ipcMain.handlers.size).toBe(0)
  })

  test('rejects IPC driver operations from another web contents', () => {
    const { bindings, terminals } = createNativeBindings()
    const ipcMain = createIpcMain()

    const dispose = setupGhosttyRenderStateIpc({
      appRoot: '/app',
      ipcMain,
      nativeBindings: bindings,
    })
    const ownerEvent = createEvent(42)
    const otherEvent = createEvent(84)

    ipcMain.handlers.get(GHOSTTY_RENDER_STATE_CREATE)?.(ownerEvent)

    const createResult = ownerEvent.returnValue as {
      ok: true
      result: { driverId: string }
    }
    const payload = { driverId: createResult.result.driverId }

    const unknownDriver = {
      ok: false,
      error: 'Ghostty native render-state driver is unknown',
    }

    ipcMain.handlers.get(GHOSTTY_RENDER_STATE_WRITE_BYTES)?.(otherEvent, {
      ...payload,
      bytes: new Uint8Array([0x68]),
    })

    expect(otherEvent.returnValue).toEqual(unknownDriver)
    expect(terminals[0]?.feed).not.toHaveBeenCalled()

    ipcMain.handlers.get(GHOSTTY_RENDER_STATE_READ_SNAPSHOT)?.(
      otherEvent,
      payload
    )
    expect(otherEvent.returnValue).toEqual(unknownDriver)

    ipcMain.handlers.get(GHOSTTY_RENDER_STATE_RESIZE)?.(otherEvent, {
      ...payload,
      size: { cols: 100, rows: 30 },
    })
    expect(otherEvent.returnValue).toEqual(unknownDriver)
    expect(terminals[0]?.resize).not.toHaveBeenCalled()

    ipcMain.handlers.get(GHOSTTY_RENDER_STATE_RESET)?.(otherEvent, payload)
    expect(otherEvent.returnValue).toEqual(unknownDriver)
    expect(terminals).toHaveLength(1)

    ipcMain.handlers.get(GHOSTTY_RENDER_STATE_DISPOSE)?.(otherEvent, payload)
    expect(otherEvent.returnValue).toEqual(unknownDriver)
    expect(terminals[0]?.dispose).not.toHaveBeenCalled()

    ipcMain.handlers.get(GHOSTTY_RENDER_STATE_DISPOSE)?.(ownerEvent, payload)
    expect(ownerEvent.returnValue).toEqual({ ok: true, result: null })

    dispose()
  })
})
