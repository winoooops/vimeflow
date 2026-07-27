// cspell:ignore Ghostty ghostty
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { clickBySelector } from '../../shared/actions.js'
import { waitForPaneCount } from '../../shared/splitView.js'

// A layout switch unmounts every pane the new layout has no slot for, which
// destroys that pane's native Ghostty surface. The pane comes back on a fresh
// surface holding only what the backend replays into it.
//
// The regression family this spec pins (each one shipped and separately
// fixed): a restored pane staying blank until the next resize; history
// hydrated at the surface's 46-column creation default; and the agent's
// bottom composer detaching from the last row after the identical resize
// gesture that was clean before the cycle.
//
// The native surface is a Metal-backed NSView with no DOM presence, so every
// assertion reads the terminal grid through `readGhosttyGrid` — neither the
// DOM nor a WebDriver screenshot can see it.

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const COMPOSER_MARKER = 'manual mode'

// CI runners have no coding agent installed, so the default is a
// deterministic alt-screen stand-in that follows the same contract (single
// alt-screen enter, bottom-anchored composer stack, full redraw on SIGWINCH).
// VIMEFLOW_E2E_AGENT=claude swaps the real agent back in for local runs.
const REAL_AGENT = process.env.VIMEFLOW_E2E_AGENT
const AGENT_COMMAND =
  REAL_AGENT ??
  `node ${path.resolve(__dirname, '..', 'altscreen-agent-fixture.cjs')}`

/** Reach a two-pane vertical split from whatever the profile restored.
 *
 *  The e2e profile persists across runs, so the workspace may already be
 *  split — in which case `:vsplit` is a no-op and no empty slot ever renders.
 */
const openVerticalSplit = async (): Promise<void> => {
  const alreadySplit = await browser.execute(
    () =>
      document.querySelectorAll('[data-testid="split-view-slot"]').length === 2
  )
  if (alreadySplit) {
    return
  }

  // A single pane here usually means a previous run persisted its zoomed
  // single-pane-focus layout — one toggle restores the split it came from,
  // and unlike the layout pills it needs no reachable UI.
  await toggleSinglePaneFocus()
  const restored = await browser
    .waitUntil(
      async () =>
        await browser.execute(
          () =>
            document.querySelectorAll('[data-testid="split-view-slot"]')
              .length === 2
        ),
      { timeout: 5_000, interval: 250 }
    )
    .then(() => true)
    .catch(() => false)
  if (restored) {
    return
  }

  // Under the native-overlay build both the command palette and the layout
  // menu live in native overlay windows the DOM cannot reach. `cycle-layout`
  // (Cmd+backslash) walks the built-in layouts instead, and the layout
  // attribute is the only reliable target: a single-pane session renders
  // vsplit as one filled slot plus one EMPTY slot, so slot counts cannot be
  // trusted here.
  const currentLayout = async (): Promise<string | null> =>
    await browser.execute(
      () =>
        document
          .querySelector('[data-testid="split-view"]')
          ?.getAttribute('data-layout') ?? null
    )
  for (
    let attempt = 0;
    attempt < 8 && (await currentLayout()) !== 'vsplit';
    attempt++
  ) {
    await browser.execute(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: '\\',
          code: 'Backslash',
          metaKey: true,
          bubbles: true,
          cancelable: true,
        })
      )
    })
    await browser.pause(400)
  }
  if ((await currentLayout()) !== 'vsplit') {
    const scene = await browser.execute(() => ({
      layout: document
        .querySelector('[data-testid="split-view"]')
        ?.getAttribute('data-layout'),
      slots: document.querySelectorAll('[data-testid="split-view-slot"]')
        .length,
    }))

    throw new Error(
      `could not reach a two-pane layout via cycle-layout: ${JSON.stringify(scene)}`
    )
  }

  const hasEmptySlot = await browser.execute(
    () =>
      document.querySelector('[data-testid="split-view-empty-slot"]') !== null
  )
  if (hasEmptySlot) {
    await clickBySelector('button[aria-label="add shell pane"]')
  }

  await waitForPaneCount(2)
}

/** Toggle the active pane to fill the session, or back.
 *
 *  `usePaneShortcuts` listens on `document` in the capture phase, so a
 *  synthesized event reaches it no matter what holds focus — unlike the
 *  command palette, which the native terminal NSView closes by stealing focus
 *  the moment it opens.
 */
const toggleSinglePaneFocus = async (): Promise<void> => {
  await browser.execute(() => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'z',
        code: 'KeyZ',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      })
    )
  })
}

/** Collapse both sidebars so the panes get the width they have in real use.
 *
 *  A cramped pane sits near the auto-collapse threshold that hides its
 *  chrome, which is its own behaviour and not what this spec is about. */
const hideSidebars = async (): Promise<void> => {
  for (const code of ['KeyB', 'KeyR']) {
    await browser.execute((keyCode: string) => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: keyCode === 'KeyB' ? 'b' : 'r',
          code: keyCode,
          metaKey: true,
          bubbles: true,
          cancelable: true,
        })
      )
    }, code)
  }
}

const nativePaneIds = async (): Promise<string[]> =>
  await browser.execute(() =>
    Array.from(
      document.querySelectorAll('[data-testid="native-ghostty-pane"]')
    ).map((pane) => pane.getAttribute('data-pty-id') ?? '')
  )

const readGrid = async (ptyId: string): Promise<string> =>
  (await browser.execute(
    async (id: string) =>
      (await window.__VIMEFLOW_E2E__?.readGhosttyGrid(id)) ?? '',
    ptyId
  )) ?? ''

/** 1-based row the agent's bottom composer sits on, or null when absent. */
const composerRow = async (ptyId: string): Promise<number | null> => {
  const grid = await readGrid(ptyId)
  const index = grid
    .split('\n')
    .findIndex((line) => line.includes(COMPOSER_MARKER))

  return index === -1 ? null : index + 1
}

interface ComposerAnchor {
  /** 1-based row the composer sits on. */
  row: number | null
  /** Rows the viewport reports. Wrapped rows are joined, so an agent drawing
   *  wider than its grid collapses this well below the real row count. */
  rows: number
}

const composerAnchor = async (ptyId: string): Promise<ComposerAnchor> => {
  const lines = (await readGrid(ptyId)).split('\n')
  const index = lines.findIndex((line) => line.includes(COMPOSER_MARKER))

  return { row: index === -1 ? null : index + 1, rows: lines.length }
}

/** Wait for the pane to stop moving, then report where its composer landed.
 *
 *  A resize moves both panes and each agent repaints on its own schedule, so
 *  a reading taken mid-flight legitimately catches them out of step. What
 *  must hold is where they come to rest.
 */
const settledComposerAnchor = async (
  ptyId: string
): Promise<ComposerAnchor> => {
  let previous = await composerAnchor(ptyId)
  for (let attempt = 0; attempt < 40; attempt++) {
    const current = await composerAnchor(ptyId)

    // Reading the grid while ghostty is reflowing can come back empty for a
    // frame. That is the read losing a race, not the pane going blank, so
    // keep polling rather than reporting a phantom empty pane.
    const settled =
      current.row !== null &&
      current.row === previous.row &&
      current.rows === previous.rows
    if (settled) {
      return current
    }

    previous = current
  }

  return previous
}

const writePty = async (ptyId: string, data: string): Promise<void> => {
  await browser.execute(
    async (id: string, payload: string) => {
      await window.__VIMEFLOW_E2E__?.invokeBackend('write_pty', {
        request: { sessionId: id, data: payload },
      })
    },
    ptyId,
    data
  )
}

const startAgent = async (ptyId: string): Promise<void> => {
  await writePty(ptyId, `${AGENT_COMMAND}\r`)

  // A real agent on a fresh e2e profile opens on its trust prompt instead of
  // the composer. The fixture never prompts; the branch simply never fires.
  let trustAccepted = false

  await browser
    .waitUntil(
      async () => {
        const grid = await readGrid(ptyId)
        if (grid.includes(COMPOSER_MARKER)) {
          return true
        }

        if (!trustAccepted && grid.includes('trust this folder')) {
          trustAccepted = true
          await writePty(ptyId, '\r')
        }

        return false
      },
      { timeout: 60_000, interval: 500 }
    )
    .catch(async (): Promise<never> => {
      const grid = await readGrid(ptyId)

      throw new Error(
        `agent never drew its composer in ${ptyId}; grid=${JSON.stringify(grid.split('\n').filter((line) => line.trim().length > 0))}`
      )
    })
}

/** The agent anchors its composer to the bottom of the terminal, so once a
 *  resize settles the composer must be on the viewport's last row.
 *
 *  A pane whose agent is drawing wider than its grid fails this twice over:
 *  the composer floats mid-screen with blank rows under it, and the wrapped
 *  rows collapse the viewport's line count. That displacement is what the
 *  user saw jumping on every shrink. */
const expectComposerAnchored = (
  anchor: ComposerAnchor,
  context: string
): void => {
  expect({ context, ...anchor }).toEqual({
    context,
    row: anchor.rows,
    rows: anchor.rows,
  })
}

/** Resize the active pane a step at a time, checking where each pane's
 *  composer comes to rest after every step. */
const resizeActivePane = async (
  panes: { left: string; right: string },
  direction: 'widen' | 'narrow',
  steps: number,
  context: string
): Promise<void> => {
  for (let step = 0; step < steps; step++) {
    await browser.execute((widen: boolean) => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: widen ? '=' : '-',
          code: widen ? 'Equal' : 'Minus',
          metaKey: true,
          bubbles: true,
          cancelable: true,
        })
      )
    }, direction === 'widen')

    expectComposerAnchored(
      await settledComposerAnchor(panes.left),
      `left pane, ${context}, step ${step + 1}`
    )
    expectComposerAnchored(
      await settledComposerAnchor(panes.right),
      `right pane, ${context}, step ${step + 1}`
    )
  }
}

/** Narrow the active pane, then widen it back.
 *
 *  Both directions matter: the user sees the jump while dragging a pane down
 *  in width, and a pane that only ever grows never re-wraps. */
const resizeBothWays = async (
  panes: { left: string; right: string },
  context: string
): Promise<void> => {
  await resizeActivePane(panes, 'narrow', 5, `narrowing ${context}`)
  await resizeActivePane(panes, 'widen', 5, `widening ${context}`)
}

/** Terminal height of every pane wide enough to still show its chrome.
 *
 *  Panes narrower than the auto-collapse threshold drop their status bar on
 *  purpose, so they are excluded — but above it the row count must not move.
 */
const terminalHeights = async (): Promise<number[]> =>
  await browser.execute(() =>
    Array.from(document.querySelectorAll('[data-testid="native-ghostty-pane"]'))
      .filter((ghostty) =>
        ghostty
          .closest('[data-testid="split-view-slot"]')
          ?.querySelector('[data-testid="terminal-pane-status-bar"]')
      )
      .map((ghostty) => Math.round(ghostty.getBoundingClientRect().height))
  )

describe('Ghostty pane remount keeps the agent composer anchored', () => {
  before(function () {
    if (
      process.platform !== 'darwin' ||
      process.env.VITE_GHOSTTY_NATIVE_MACOS_PARENT !== '1'
    ) {
      this.skip()
    }
  })

  it('rehydrates a cycled pane and holds the composer row through resizes', async () => {
    // A wide window keeps both panes far above the auto-collapse threshold
    // through every narrowing step, so the pane's own collapse behaviour
    // never mixes into what this spec measures.
    await browser.electron.execute((electron: typeof import('electron')) => {
      const win = electron.BrowserWindow.getAllWindows()[0]
      win?.setSize(1720, 980)
      win?.center()
    })

    await (
      await $('[data-testid="terminal-pane"]')
    ).waitForDisplayed({ timeout: 20_000 })

    await hideSidebars()
    await openVerticalSplit()

    const [leftPtyId, rightPtyId] = await nativePaneIds()
    if (!leftPtyId || !rightPtyId) {
      throw new Error('vertical split did not expose two native ghostty panes')
    }

    const panes = { left: leftPtyId, right: rightPtyId }
    await startAgent(leftPtyId)
    await startAgent(rightPtyId)

    expectComposerAnchored(
      await settledComposerAnchor(leftPtyId),
      'left pane at rest'
    )
    expectComposerAnchored(
      await settledComposerAnchor(rightPtyId),
      'right pane at rest'
    )

    // Control: the identical gesture BEFORE any layout cycle — the baseline
    // the post-cycle assertions are measured against. Narrowing must not
    // change a pane's row count either: the terminal's height is what the
    // agent lays its frame out against, so a height step shifts the whole
    // frame and reads as the content jumping.
    const baselineHeights = await terminalHeights()
    await resizeBothWays(panes, 'before a layout cycle')
    expect(await terminalHeights()).toEqual(baselineHeights)

    // Cycle the panes out of the layout and back: the destroy/rebuild that
    // drops each surface. Zoom a KNOWN pane so it is clear which surface is
    // kept (the zoomed one) and which is destroyed (the hidden one).
    await toggleSinglePaneFocus()
    await waitForPaneCount(1)
    await toggleSinglePaneFocus()
    await waitForPaneCount(2)

    // The first shipped regression: a restored pane hydrated from nothing
    // and stayed blank until the user's next resize. The composer must come
    // back on its own — no resize, no agent output, just the replay.
    await browser.waitUntil(
      async () =>
        (await composerRow(leftPtyId)) !== null &&
        (await composerRow(rightPtyId)) !== null,
      {
        timeout: 20_000,
        interval: 250,
        timeoutMsg:
          'restored panes never redrew their composers without a resize',
      }
    )

    // And the replay must have landed on a full-size grid, not the 46-column
    // creation default — wrapped hydration collapses the joined row count
    // and floats the composer mid-screen, which the anchor check rejects.
    expectComposerAnchored(
      await settledComposerAnchor(leftPtyId),
      'left pane after restore, before any resize'
    )
    expectComposerAnchored(
      await settledComposerAnchor(rightPtyId),
      'right pane after restore, before any resize'
    )

    // The second shipped regression: the identical gestures on the rebuilt
    // surfaces made the composer jump on every shrink, forever.
    await resizeBothWays(panes, 'after a layout cycle')
    expect(await terminalHeights()).toEqual(baselineHeights)
  })
})
