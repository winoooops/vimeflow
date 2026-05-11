import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

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
    const filesTab = await $('button=FILES')
    await filesTab.waitForDisplayed({ timeout: 15_000 })
    await filesTab.click()

    const explorer = await $('[data-testid="file-explorer"]')
    await explorer.waitForDisplayed({ timeout: 15_000 })

    const refreshButton = await $('[aria-label="Refresh file tree"]')
    await refreshButton.waitForDisplayed({ timeout: 15_000 })
    await refreshButton.click()

    await browser.waitUntil(
      async () => {
        return browser.execute((name: string) => {
          const items = Array.from(
            document.querySelectorAll<HTMLElement>('[role="treeitem"]')
          )

          return items.some(
            (el) =>
              !el.hasAttribute('aria-expanded') &&
              (el.textContent ?? '').includes(name)
          )
        }, FIXTURE_NAME)
      },
      {
        timeout: 15_000,
        timeoutMsg: `fixture ${FIXTURE_NAME} never appeared in the refreshed file tree`,
      }
    )

    // Click our fixture file specifically. Falls back to an error if the
    // explorer filtered out dotfiles — which would matter for this test
    // since we rely on the dotfile showing up.
    const fileTargeted = await browser.execute((name: string) => {
      const items = Array.from(
        document.querySelectorAll<HTMLElement>('[role="treeitem"]')
      )
      const fixture = items.find(
        (el) =>
          !el.hasAttribute('aria-expanded') &&
          (el.textContent ?? '').includes(name)
      )
      if (!fixture) return null
      const target =
        fixture.querySelector<HTMLElement>('.cursor-pointer') ?? fixture
      target.click()
      return fixture.textContent?.trim() ?? ''
    }, FIXTURE_NAME)

    if (fileTargeted === null) {
      throw new Error(
        `fixture ${FIXTURE_NAME} not present in the file tree — ` +
          'dotfiles may be hidden, or the explorer root is not $HOME'
      )
    }

    // BottomDrawer header shows the selected file (or "No file").
    await browser.waitUntil(
      async () => {
        const bottomDrawer = await $('[data-testid="bottom-drawer"]')
        const text = await bottomDrawer.getText()
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
