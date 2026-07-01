import { clickBySelector } from '../../shared/actions.js'

describe('BottomDrawer navigation', () => {
  it('defaults to diff panel and switches to editor panel on click', async () => {
    await clickBySelector('button[aria-label="Show editor & diff panel"]')

    const initialDiffPanel = await $('[data-testid="diff-panel"]')
    await initialDiffPanel.waitForDisplayed({ timeout: 15_000 })

    await clickBySelector('button[aria-label="Editor"]')

    const editorPanel = await $('[data-testid="editor-panel"]')
    await editorPanel.waitForDisplayed({ timeout: 10_000 })

    await browser.waitUntil(
      async () => !(await (await $('[data-testid="diff-panel"]')).isExisting()),
      {
        timeout: 5_000,
        timeoutMsg: 'diff-panel still in DOM after switching to editor',
      }
    )

    await clickBySelector('button[aria-label="Diff Viewer"]')

    await (
      await $('[data-testid="diff-panel"]')
    ).waitForDisplayed({
      timeout: 10_000,
    })

    await browser.waitUntil(
      async () =>
        !(await (await $('[data-testid="editor-panel"]')).isExisting()),
      {
        timeout: 5_000,
        timeoutMsg: 'editor-panel still in DOM after switching to diff',
      }
    )
  })
})
