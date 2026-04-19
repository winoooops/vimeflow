describe('IPC round-trip', () => {
  it('file explorer populates with directory entries from Rust list_dir', async () => {
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
