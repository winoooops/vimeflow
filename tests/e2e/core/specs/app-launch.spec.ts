describe('app launch', () => {
  it('renders workspace view with the sidebar top bar and sidebar', async () => {
    const workspace = await $('[data-testid="workspace-view"]')
    await workspace.waitForDisplayed({ timeout: 15_000 })

    const sidebarTopBar = await $('[data-testid="sidebar-top-bar"]')
    await sidebarTopBar.waitForDisplayed()

    const sidebar = await $('[data-testid="sidebar"]')
    await sidebar.waitForDisplayed()

    const settingsFooter = await $('[data-testid="sidebar-settings-footer"]')
    await settingsFooter.waitForDisplayed()

    const settingsText = await settingsFooter.getText()
    if (!settingsText.includes('Settings')) {
      throw new Error('Settings did not render in the sidebar footer')
    }

    const commandButtonInTopBar = await browser.execute(() => {
      const topBar = document.querySelector('[data-testid="sidebar-top-bar"]')
      return Boolean(topBar?.querySelector('[aria-label="Command Palette"]'))
    })
    if (commandButtonInTopBar) {
      throw new Error(
        'Command Palette button still renders in the sidebar top bar'
      )
    }

    const newSessionButton = await $('[data-testid="sidebar-new-session"]')
    await newSessionButton.waitForDisplayed()
    const compactWidth = await newSessionButton.getSize('width')

    await browser.execute(() => {
      document
        .querySelector<HTMLElement>('[data-testid="workspace-view"]')
        ?.style.setProperty('--workspace-sidebar-width', '360px')
    })

    await browser.waitUntil(
      async () => {
        const expandedWidth = await newSessionButton.getSize('width')
        return expandedWidth > compactWidth + 60
      },
      {
        timeout: 5_000,
        timeoutMsg: 'New session button did not expand with the sidebar',
      }
    )

    await browser.waitUntil(
      async () => {
        const labelOpacity = await browser.execute(() => {
          const label = document.querySelector<HTMLElement>(
            '.vf-new-session-label'
          )
          return label === null ? 0 : Number(getComputedStyle(label).opacity)
        })
        return labelOpacity > 0.95
      },
      {
        timeout: 5_000,
        timeoutMsg: 'New session label did not reveal at expanded width',
      }
    )

    await browser.execute(() => {
      document
        .querySelector<HTMLElement>('[data-testid="workspace-view"]')
        ?.style.setProperty('--workspace-sidebar-width', '520px')
    })

    await browser.waitUntil(
      async () => {
        const cappedWidth = await newSessionButton.getSize('width')
        return cappedWidth <= 150 && cappedWidth >= 140
      },
      {
        timeout: 5_000,
        timeoutMsg: 'New session button did not respect the 150px width cap',
      }
    )

    await browser.waitUntil(
      async () => {
        const alignment = await browser.execute(() => {
          const card = document
            .querySelector('[data-testid="sidebar-agent-status-card"]')
            ?.getBoundingClientRect()
          const button = document
            .querySelector('[data-testid="sidebar-new-session"]')
            ?.getBoundingClientRect()

          return {
            cardWidth: card?.width ?? 0,
            rightEdgeDelta:
              card && button ? Math.abs(card.right - button.right) : Infinity,
          }
        })

        return alignment.cardWidth <= 360 && alignment.rightEdgeDelta <= 1
      },
      {
        timeout: 5_000,
        timeoutMsg:
          'Agent status card did not align with the new session row cap',
      }
    )
  })
})
