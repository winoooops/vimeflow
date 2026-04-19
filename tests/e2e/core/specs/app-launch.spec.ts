describe('app launch', () => {
  it('renders workspace view with icon rail and sidebar', async () => {
    const workspace = await $('[data-testid="workspace-view"]')
    await workspace.waitForDisplayed({ timeout: 15_000 })

    const iconRail = await $('[data-testid="icon-rail"]')
    await iconRail.waitForDisplayed()

    const sidebar = await $('[data-testid="sidebar"]')
    await sidebar.waitForDisplayed()
  })
})
