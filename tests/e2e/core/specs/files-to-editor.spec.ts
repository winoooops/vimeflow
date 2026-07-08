import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { clickBySelector } from '../../shared/actions.js'

const FIXTURE_NAME = 'vimeflow-e2e-fixture.txt'
const FIXTURE_PATH = path.join(os.homedir(), FIXTURE_NAME)
const FIXTURE_CONTENT = `__E2E_FIXTURE__ ${Date.now()}\nsecond line\n`

describe('File explorer → editor flow', () => {
  before(() => {
    fs.writeFileSync(FIXTURE_PATH, FIXTURE_CONTENT)
  })
  after(() => {
    try {
      fs.unlinkSync(FIXTURE_PATH)
    } catch {
      // Fixture may already be gone; ignore.
    }
  })

  it('clicking a file entry loads content into the editor', async () => {
    // After issue #175, the file explorer lives behind the sidebar's FILES
    // tab (instead of always-visible bottom pane). Click the FILES tab so
    // FilesView's root toggles from the Tailwind `hidden` utility class to
    // `flex` (HTML `hidden` attribute is NOT used — see SessionsView /
    // FilesView source for the Tailwind v4 cascade-layer rationale).
    const filesTab = await $('button[aria-label="FILES"]')
    await filesTab.waitForDisplayed({ timeout: 15_000 })
    await clickBySelector('button[aria-label="FILES"]')

    const explorer = await $('[data-testid="file-explorer"]')
    await explorer.waitForDisplayed({ timeout: 15_000 })

    const refreshButton = await $('[aria-label="Refresh file tree"]')
    await refreshButton.waitForDisplayed({ timeout: 15_000 })
    await clickBySelector('[aria-label="Refresh file tree"]')

    await browser.waitUntil(
      async () =>
        browser.execute((fileName: string) => {
          const items = Array.from(
            document.querySelectorAll<HTMLElement>(
              '[role="treeitem"][data-file-type="file"]'
            )
          )

          return items.some(
            (el) => el.dataset.fileName === fileName && el.offsetParent !== null
          )
        }, FIXTURE_NAME),
      {
        timeout: 15_000,
        timeoutMsg: `fixture ${FIXTURE_NAME} never appeared in the refreshed file tree`,
      }
    )

    const fileTargeted = await browser.execute((fileName: string) => {
      const fixture = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[role="treeitem"][data-file-type="file"]'
        )
      ).find((el) => el.dataset.fileName === fileName)
      if (!fixture) return null
      const target =
        fixture.querySelector<HTMLElement>('.cursor-pointer') ?? fixture
      target.click()
      return fixture.dataset.filePath ?? ''
    }, FIXTURE_NAME)

    if (fileTargeted === null) {
      throw new Error(
        `fixture ${FIXTURE_NAME} not present in the file tree — ` +
          'dotfiles may be hidden, or the explorer root is not $HOME'
      )
    }

    // DockPanel header shows the selected file (or "No file").
    await browser.waitUntil(
      async () => {
        const dockPanel = await $('[data-testid="dock-panel"]')
        const text = await dockPanel.getText()
        return text.includes(FIXTURE_NAME)
      },
      {
        timeout: 15_000,
        timeoutMsg: `selected-file header never updated (clicked: ${fileTargeted})`,
      }
    )

    // CodeMirror should mount and contain our fixture's content.
    await browser.waitUntil(
      async () => {
        const text = await browser.execute(() => {
          const editor = document.querySelector<HTMLElement>('.cm-content')
          return editor?.textContent ?? ''
        })
        return text.includes('__E2E_FIXTURE__')
      },
      {
        timeout: 10_000,
        timeoutMsg:
          'CodeMirror never rendered fixture content after file click',
      }
    )
  })
})
