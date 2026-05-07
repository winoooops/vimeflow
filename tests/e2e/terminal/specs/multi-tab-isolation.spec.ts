import { clickBySelector } from '../../shared/actions.js'
import {
  pressEnterInActiveTerminal,
  typeInActiveTerminal,
} from '../../shared/terminal.js'

const waitForSessionPromptReady = async (sessionId: string): Promise<void> => {
  await browser.waitUntil(
    async () => {
      const buf = await browser.execute(
        (id: string) =>
          window.__VIMEFLOW_E2E__?.getTerminalBufferForSession(id) ?? '',
        sessionId
      )
      return buf.trim().length > 0
    },
    {
      timeout: 20_000,
      timeoutMsg: `session ${sessionId} never produced a prompt`,
    }
  )
}

const allSessionIds = async (): Promise<string[]> =>
  browser.execute(() => {
    // Both the TerminalZone wrapper and the inner TerminalPane carry
    // data-testid="terminal-pane" + data-session-id, so dedupe.
    const seen = new Set<string>()
    document
      .querySelectorAll<HTMLElement>(
        '[data-testid="terminal-pane"][data-session-id]'
      )
      .forEach((el) => {
        const id = el.dataset.sessionId
        if (id) seen.add(id)
      })
    return Array.from(seen)
  })

// Returns the data-session-id of the latest spawned tab (document
// order), or null if the supplied sessionId has no terminal-pane in
// the DOM. Renamed from `getSessionLabel` to reflect what it actually
// returns — an opaque session id, not a human-readable label.
const getLatestSessionTabId = async (
  sessionId: string
): Promise<string | null> =>
  browser.execute((id: string) => {
    // Mirror cycle-15's id-based lookup pattern in Sidebar.tsx (and
    // SessionTabs.tsx originally): every TerminalZone panel is rendered
    // with `id="session-panel-${session.id}"`, so getElementById keeps
    // session ids out of the CSS-attribute parser entirely. Same
    // correctness invariant as docs/reviews/patterns/accessibility.md
    // finding #14 — applies here too even if the runtime symptom would
    // surface inside `browser.execute` rather than at user-facing focus.
    const pane = document.getElementById(`session-panel-${id}`)
    if (!pane) return null
    const tabs = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-testid="session-tab"][data-session-id]'
      )
    )
    return tabs[tabs.length - 1]?.getAttribute('data-session-id') ?? null
  }, sessionId)

describe('Multi-tab terminal isolation', () => {
  it('keeps typed output scoped to the active session', async () => {
    await (
      await $('[data-testid="terminal-pane"]')
    ).waitForDisplayed({ timeout: 20_000 })

    // Baseline: default session.
    const [session1Id] = await allSessionIds()
    if (!session1Id) {
      throw new Error('expected one default session on launch')
    }
    await waitForSessionPromptReady(session1Id)

    // Type marker A into session 1.
    const markerA = `__E2E_A_${Date.now()}__`
    await typeInActiveTerminal(`echo ${markerA}`)
    await pressEnterInActiveTerminal()
    await browser.waitUntil(
      async () => {
        const buf = await browser.execute(
          (id: string) =>
            window.__VIMEFLOW_E2E__?.getTerminalBufferForSession(id) ?? '',
          session1Id
        )
        return buf.includes(markerA)
      },
      { timeout: 15_000, timeoutMsg: 'marker A never landed in session 1' }
    )

    // Spawn session 2 via the SessionTabs "+" button.
    await clickBySelector('button[aria-label="New session"]')
    await browser.waitUntil(async () => (await allSessionIds()).length === 2, {
      timeout: 10_000,
      timeoutMsg: 'second session did not mount',
    })
    const ids = await allSessionIds()
    const session2Id = ids.find((id) => id !== session1Id)
    if (!session2Id) {
      throw new Error('could not identify second session')
    }

    // Switching happens automatically on new-tab; verify visible pane flipped.
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () => window.__VIMEFLOW_E2E__?.getVisibleSessionId() ?? null
        )) === session2Id,
      { timeout: 10_000, timeoutMsg: 'session 2 never became visible' }
    )

    await waitForSessionPromptReady(session2Id)

    const markerB = `__E2E_B_${Date.now()}__`
    await typeInActiveTerminal(`echo ${markerB}`)
    await pressEnterInActiveTerminal()
    await browser.waitUntil(
      async () => {
        const buf = await browser.execute(
          (id: string) =>
            window.__VIMEFLOW_E2E__?.getTerminalBufferForSession(id) ?? '',
          session2Id
        )
        return buf.includes(markerB)
      },
      { timeout: 15_000, timeoutMsg: 'marker B never landed in session 2' }
    )

    // Cross-contamination check: marker A should not leak into session 2,
    // marker B should not leak into session 1.
    const s1 = await browser.execute(
      (id: string) =>
        window.__VIMEFLOW_E2E__?.getTerminalBufferForSession(id) ?? '',
      session1Id
    )
    const s2 = await browser.execute(
      (id: string) =>
        window.__VIMEFLOW_E2E__?.getTerminalBufferForSession(id) ?? '',
      session2Id
    )
    expect(s1).toContain(markerA)
    expect(s1).not.toContain(markerB)
    expect(s2).toContain(markerB)
    expect(s2).not.toContain(markerA)

    // `getLatestSessionTabId` is exercised to confirm the helper
    // doesn't throw, but we don't assert on its value — tab id is
    // ephemeral.
    void (await getLatestSessionTabId(session2Id))
  })
})
