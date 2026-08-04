import { clickBySelector } from '../../shared/actions.js'
import { switchToLayout, waitForPaneCount } from '../../shared/splitView.js'

interface ProgressSnapshot {
  readonly exists: boolean
  readonly value: string | null
  readonly valueText: string | null
  readonly width: string | null
}

const readProgress = async (ptyId: string): Promise<ProgressSnapshot> =>
  browser.execute((id: string) => {
    const slot = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="split-view-slot"]')
    ).find((candidate) => candidate.dataset.ptyId === id)
    const bar = slot?.querySelector<HTMLElement>(
      '[data-testid="terminal-pane-progress"]'
    )
    const fill = slot?.querySelector<HTMLElement>(
      '[data-testid="terminal-pane-progress-fill"]'
    )

    return {
      exists: bar !== null && bar !== undefined,
      value: bar?.getAttribute('aria-valuenow') ?? null,
      valueText: bar?.getAttribute('aria-valuetext') ?? null,
      width: fill?.style.width ?? null,
    }
  }, ptyId)

const writePty = async (ptyId: string, data: string): Promise<void> => {
  await browser.execute(
    async (id: string, input: string) => {
      await window.__VIMEFLOW_E2E__?.invokeBackend('write_pty', {
        request: { sessionId: id, data: input },
      })
    },
    ptyId,
    data
  )
}

const printProgress = async (
  ptyId: string,
  state: number,
  value?: number
): Promise<void> => {
  const payload = value === undefined ? `${state}` : `${state};${value}`

  await writePty(ptyId, `printf '\\033]9;4;${payload}\\007'\r`)
}

const visiblePtyIds = async (): Promise<string[]> =>
  browser.execute(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-testid="split-view-slot"][data-pty-id]'
      )
    ).flatMap((slot) => (slot.dataset.ptyId ? [slot.dataset.ptyId] : []))
  )

describe('PTY progress reports', () => {
  it('renders real shell OSC progress without leaking notifications or pane state', async () => {
    await (
      await $('[data-testid="terminal-pane"]')
    ).waitForDisplayed({ timeout: 20_000 })

    const [firstPtyId] = await visiblePtyIds()
    if (!firstPtyId) {
      throw new Error('default pane has no PTY id')
    }

    await printProgress(firstPtyId, 3)
    await browser.waitUntil(
      async () => {
        const progress = await readProgress(firstPtyId)

        return (
          progress.exists &&
          progress.value === null &&
          progress.valueText === 'In progress' &&
          progress.width === '32%'
        )
      },
      { timeoutMsg: 'indeterminate progress did not render' }
    )

    await printProgress(firstPtyId, 1, 42)
    await browser.waitUntil(
      async () => {
        const progress = await readProgress(firstPtyId)

        return progress.value === '42' && progress.width === '42%'
      },
      { timeoutMsg: 'normal 42% progress did not render' }
    )

    await printProgress(firstPtyId, 1, 80)
    await browser.waitUntil(
      async () => {
        const progress = await readProgress(firstPtyId)

        return progress.value === '80' && progress.width === '80%'
      },
      { timeoutMsg: 'normal progress did not update to 80%' }
    )

    await printProgress(firstPtyId, 0)
    await browser.waitUntil(
      async () => !(await readProgress(firstPtyId)).exists,
      { timeoutMsg: 'remove progress did not hide the header bar' }
    )

    await switchToLayout('Vertical split')
    await clickBySelector('button[aria-label="add shell pane"]')
    await waitForPaneCount(2)
    await clickBySelector('[data-testid="split-view-slot"][data-pane-id="p0"]')
    await browser.waitUntil(
      async () =>
        await browser.execute(
          () =>
            document
              .querySelector(
                '[data-testid="split-view-slot"][data-pane-id="p0"]'
              )
              ?.getAttribute('data-pane-active') === 'true'
        ),
      { timeoutMsg: 'first pane did not become active' }
    )

    const ptyIds = await visiblePtyIds()
    const secondPtyId = ptyIds.find((id) => id !== firstPtyId)
    if (!secondPtyId) {
      throw new Error('second pane has no distinct PTY id')
    }

    await printProgress(firstPtyId, 1, 30)
    await printProgress(secondPtyId, 1, 60)
    await browser.waitUntil(
      async () =>
        (await readProgress(firstPtyId)).value === '30' &&
        (await readProgress(secondPtyId)).value === '60',
      { timeoutMsg: 'both panes did not retain independent progress' }
    )

    await browser.pause(750)
    expect(
      await browser.execute(
        () =>
          document
            .querySelector('[data-testid="session-island"]')
            ?.getAttribute('data-state') ?? null
      )
    ).toBe('pill')

    await writePty(secondPtyId, 'exit\r')
    await browser.waitUntil(
      async () =>
        !(await readProgress(secondPtyId)).exists &&
        (await readProgress(firstPtyId)).value === '30',
      {
        timeout: 15_000,
        timeoutMsg: 'exiting one pane disturbed another pane progress',
      }
    )
  })
})
