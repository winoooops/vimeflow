import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { clickBySelector } from '../../shared/actions.js'

const FIXTURE_NAME = `vimeflow-e2e-ipc-${Date.now()}.txt`
const FIXTURE_PATH = path.join(os.homedir(), FIXTURE_NAME)

describe('IPC round-trip', () => {
  before(() => {
    fs.writeFileSync(FIXTURE_PATH, 'ipc fixture\n')
  })

  after(() => {
    try {
      fs.unlinkSync(FIXTURE_PATH)
    } catch {
      // Fixture may already be gone; ignore.
    }
  })

  it('file explorer populates with directory entries from Rust list_dir', async () => {
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

    // Rust list_dir populates the tree; wait until at least one row shows up.
    await browser.waitUntil(
      async () => {
        return browser.execute((name: string) => {
          const items = Array.from(
            document.querySelectorAll<HTMLElement>('[role="treeitem"]')
          )

          return items.some((el) => (el.textContent ?? '').includes(name))
        }, FIXTURE_NAME)
      },
      {
        timeout: 15_000,
        timeoutMsg:
          'File explorer stayed empty — list_dir IPC did not populate entries',
      }
    )
  })
})
