import { clickBySelector } from '../../shared/actions.js'

describe('BottomDrawer navigation', () => {
  it('defaults to editor panel and switches to diff panel on click', async () => {
    const editorPanel = await $('[data-testid="editor-panel"]')
    await editorPanel.waitForDisplayed({ timeout: 15_000 })

    await clickBySelector('button[aria-label="Diff Viewer"]')

    const diffPanel = await $('[data-testid="diff-panel"]')
    await diffPanel.waitForDisplayed({ timeout: 10_000 })

    await browser.waitUntil(
      async () =>
        !(await (await $('[data-testid="editor-panel"]')).isExisting()),
      {
        timeout: 5_000,
        timeoutMsg: 'editor-panel still in DOM after switching to diff',
      }
    )

    await clickBySelector('button[aria-label="Editor"]')
    await (
      await $('[data-testid="editor-panel"]')
    ).waitForDisplayed({
      timeout: 10_000,
    })
  })
})
