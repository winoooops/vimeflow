describe('IPC round-trip', () => {
  it('file explorer populates with directory entries from Rust list_dir', async () => {
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

    // Rust list_dir populates the tree; wait until at least one row shows up.
    await browser.waitUntil(
      async () => {
        const text = await explorer.getText()
        return text.trim().length > 0
      },
      {
        timeout: 15_000,
        timeoutMsg:
          'File explorer stayed empty — list_dir IPC did not populate entries',
      }
    )
  })
})
