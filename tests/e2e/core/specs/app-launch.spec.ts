describe('app launch', () => {
  it('renders workspace view with the sidebar top bar and sidebar', async () => {
    const workspace = await $('[data-testid="workspace-view"]')
    await workspace.waitForDisplayed({ timeout: 15_000 })

    const sidebarTopBar = await $('[data-testid="sidebar-top-bar"]')
    await sidebarTopBar.waitForDisplayed()

    const sidebar = await $('[data-testid="sidebar"]')
    await sidebar.waitForDisplayed()
  })
})
