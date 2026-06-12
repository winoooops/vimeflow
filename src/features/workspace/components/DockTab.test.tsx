import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, test, expect, vi } from 'vitest'
import { DockTab } from './DockTab'

describe('DockTab', () => {
  test('renders Editor and Diff Viewer buttons', () => {
    render(
      <DockTab
        tab="editor"
        onTabChange={vi.fn()}
        selectedFilePath={null}
        collapseIconName="expand_more"
        onClose={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: /editor/i })).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: /diff viewer/i })
    ).toBeInTheDocument()
  })

  test('active tab gets chip styling', () => {
    render(
      <DockTab
        tab="diff"
        onTabChange={vi.fn()}
        selectedFilePath={null}
        collapseIconName="expand_more"
        onClose={vi.fn()}
      />
    )

    const diffTab = screen.getByRole('button', { name: /diff viewer/i })
    expect(diffTab).toHaveClass('rounded-md')
    expect(diffTab).toHaveClass('bg-primary/[0.08]')
    expect(diffTab).toHaveClass('border-primary-container/30')
    expect(diffTab).toHaveClass('text-primary')
  })

  test('clicking a tab calls onTabChange with the right id', async () => {
    const user = userEvent.setup()
    const onTabChange = vi.fn()
    render(
      <DockTab
        tab="editor"
        onTabChange={onTabChange}
        selectedFilePath={null}
        collapseIconName="expand_more"
        onClose={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: /diff viewer/i }))

    expect(onTabChange).toHaveBeenCalledWith('diff')
  })

  test('children render between tabs and the path/close cluster', () => {
    render(
      <DockTab
        tab="editor"
        onTabChange={vi.fn()}
        selectedFilePath="~/src/app.tsx"
        collapseIconName="expand_more"
        onClose={vi.fn()}
      >
        <div>Switcher slot</div>
      </DockTab>
    )

    const diffTab = screen.getByRole('button', { name: /diff viewer/i })
    const slot = screen.getByText('Switcher slot')
    const filePath = screen.getByText('src/app.tsx')

    expect(
      diffTab.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()

    expect(
      slot.compareDocumentPosition(filePath) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  test('compactActions hides auxiliary controls behind a more button', async () => {
    const user = userEvent.setup()
    render(
      <DockTab
        tab="editor"
        onTabChange={vi.fn()}
        selectedFilePath="~/src/app.tsx"
        collapseIconName="chevron_left"
        onClose={vi.fn()}
        compactActions
      >
        <div>Switcher slot</div>
      </DockTab>
    )

    expect(screen.getByRole('button', { name: /editor/i })).toBeInTheDocument()
    expect(screen.queryByText('Switcher slot')).not.toBeInTheDocument()
    expect(screen.queryByText('src/app.tsx')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /more dock actions/i }))

    expect(screen.getByTestId('dock-actions-menu')).toBeInTheDocument()
    expect(screen.getByText('Switcher slot')).toBeInTheDocument()
    expect(screen.getByText('src/app.tsx')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /collapse panel/i })
    ).toBeInTheDocument()
  })

  test('compact menu closes when clicking outside', async () => {
    const user = userEvent.setup()
    render(
      <DockTab
        tab="editor"
        onTabChange={vi.fn()}
        selectedFilePath={null}
        collapseIconName="chevron_left"
        onClose={vi.fn()}
        compactActions
      >
        <div>Switcher slot</div>
      </DockTab>
    )

    await user.click(screen.getByRole('button', { name: /more dock actions/i }))
    expect(screen.getByTestId('dock-actions-menu')).toBeInTheDocument()

    // Fire mousedown on document.body — outside the menu; wrap in act so
    // the React state update from the listener is flushed before asserting.
    act(() => {
      document.body.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true })
      )
    })

    expect(screen.queryByTestId('dock-actions-menu')).not.toBeInTheDocument()
  })

  test('compactActions closes the menu on Escape', async () => {
    const user = userEvent.setup()
    render(
      <DockTab
        tab="editor"
        onTabChange={vi.fn()}
        selectedFilePath={null}
        collapseIconName="chevron_left"
        onClose={vi.fn()}
        compactActions
      >
        <div>Switcher slot</div>
      </DockTab>
    )

    await user.click(screen.getByRole('button', { name: /more dock actions/i }))
    expect(screen.getByTestId('dock-actions-menu')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByTestId('dock-actions-menu')).not.toBeInTheDocument()
  })

  test('clicking the close button calls onClose', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <DockTab
        tab="editor"
        onTabChange={vi.fn()}
        selectedFilePath={null}
        collapseIconName="expand_more"
        onClose={onClose}
      />
    )

    await user.click(screen.getByRole('button', { name: /collapse panel/i }))

    expect(onClose).toHaveBeenCalled()
  })

  test('file path renders and truncates home prefix', () => {
    render(
      <DockTab
        tab="editor"
        onTabChange={vi.fn()}
        selectedFilePath="~/src/app.tsx"
        collapseIconName="expand_more"
        onClose={vi.fn()}
      />
    )

    expect(screen.getByText('src/app.tsx')).toBeInTheDocument()
    expect(screen.queryByText('~/src/app.tsx')).not.toBeInTheDocument()
  })

  test('close button uses the icon name passed via collapseIconName', () => {
    render(
      <DockTab
        tab="editor"
        onTabChange={vi.fn()}
        selectedFilePath={null}
        collapseIconName="chevron_left"
        onClose={vi.fn()}
      />
    )

    const closeButton = screen.getByRole('button', { name: /collapse panel/i })
    expect(within(closeButton).getByText('chevron_left')).toBeInTheDocument()
  })

  // F1: actionsOpen is cleared when compactActions transitions to false
  test('menu is hidden and actionsOpen resets when compactActions changes to false', async () => {
    const user = userEvent.setup()

    const { rerender } = render(
      <DockTab
        tab="editor"
        onTabChange={vi.fn()}
        selectedFilePath={null}
        collapseIconName="chevron_left"
        onClose={vi.fn()}
        compactActions
      />
    )

    // Open the menu
    await user.click(screen.getByRole('button', { name: /more dock actions/i }))
    expect(screen.getByTestId('dock-actions-menu')).toBeInTheDocument()

    // Widen the dock → compactActions goes false
    rerender(
      <DockTab
        tab="editor"
        onTabChange={vi.fn()}
        selectedFilePath={null}
        collapseIconName="chevron_left"
        onClose={vi.fn()}
      />
    )

    // Menu element is gone (not rendered) and actionsOpen was cleared,
    // so narrowing again should not auto-open the menu
    expect(screen.queryByTestId('dock-actions-menu')).not.toBeInTheDocument()

    // Narrow again → compactActions back to true; menu must NOT auto-open
    rerender(
      <DockTab
        tab="editor"
        onTabChange={vi.fn()}
        selectedFilePath={null}
        collapseIconName="chevron_left"
        onClose={vi.fn()}
        compactActions
      />
    )

    expect(screen.queryByTestId('dock-actions-menu')).not.toBeInTheDocument()
  })

  // F4: clicking the trigger button a second time closes the menu
  test('clicking the trigger button while menu is open closes it', async () => {
    const user = userEvent.setup()
    render(
      <DockTab
        tab="editor"
        onTabChange={vi.fn()}
        selectedFilePath={null}
        collapseIconName="chevron_left"
        onClose={vi.fn()}
        compactActions
      />
    )

    const triggerButton = screen.getByRole('button', {
      name: /more dock actions/i,
    })

    // First click: open
    await user.click(triggerButton)
    expect(screen.getByTestId('dock-actions-menu')).toBeInTheDocument()

    // Second click: close
    await user.click(triggerButton)
    expect(screen.queryByTestId('dock-actions-menu')).not.toBeInTheDocument()
  })

  describe('tooltip wiring', () => {
    test('Editor tab tooltip shows the Mod+E shortcut chip', async () => {
      const user = userEvent.setup()
      render(
        <DockTab
          tab="diff"
          onTabChange={vi.fn()}
          selectedFilePath={null}
          collapseIconName="expand_more"
          onClose={vi.fn()}
        />
      )

      await user.hover(screen.getByRole('button', { name: /editor/i }))
      const tip = await screen.findByRole('tooltip')
      expect(tip).toHaveTextContent('Editor')
      expect(within(tip).getByTestId('tooltip-shortcut')).toHaveTextContent('E')
    })

    test('Diff Viewer tab tooltip shows the Mod+G shortcut chip', async () => {
      const user = userEvent.setup()
      render(
        <DockTab
          tab="editor"
          onTabChange={vi.fn()}
          selectedFilePath={null}
          collapseIconName="expand_more"
          onClose={vi.fn()}
        />
      )

      await user.hover(screen.getByRole('button', { name: /diff viewer/i }))
      const tip = await screen.findByRole('tooltip')
      expect(tip).toHaveTextContent('Diff Viewer')
      expect(within(tip).getByTestId('tooltip-shortcut')).toHaveTextContent('G')
    })

    test('Collapse panel tooltip is plain (no shortcut chip)', async () => {
      const user = userEvent.setup()
      render(
        <DockTab
          tab="editor"
          onTabChange={vi.fn()}
          selectedFilePath={null}
          collapseIconName="expand_more"
          onClose={vi.fn()}
        />
      )

      await user.hover(screen.getByRole('button', { name: /collapse panel/i }))
      const tip = await screen.findByRole('tooltip')
      expect(tip).toHaveTextContent('Collapse panel')
      expect(within(tip).queryByTestId('tooltip-shortcut')).toBeNull()
    })

    // Guards the `disabled={actionsOpen}` branch on the More button's
    // Tooltip. Without that disable, an open dropdown menu would have
    // a tooltip stacked on top of it (visually noisy) AND the
    // tooltip's useDismiss would steal the Escape key the menu listens
    // for — re-introducing the 5b regression that failed the
    // "compactActions closes the menu on Escape" test above.
    test('More dock actions tooltip is suppressed while the menu is open', async () => {
      const user = userEvent.setup()
      render(
        <DockTab
          tab="editor"
          onTabChange={vi.fn()}
          selectedFilePath={null}
          collapseIconName="chevron_left"
          onClose={vi.fn()}
          compactActions
        >
          <div>Switcher slot</div>
        </DockTab>
      )

      const triggerButton = screen.getByRole('button', {
        name: /more dock actions/i,
      })

      // Open the menu, then hover the trigger. The Tooltip is disabled
      // when actionsOpen is true, so no tooltip must appear.
      await user.click(triggerButton)
      expect(screen.getByTestId('dock-actions-menu')).toBeInTheDocument()
      await user.hover(triggerButton)

      // Wait past the Tooltip's 250 ms hover delay before asserting
      // absence. Without this wait, the assertion runs before any
      // tooltip could appear and would still pass even if
      // `disabled={actionsOpen}` regressed — making the negative
      // assertion meaningless (codex verify cycle 1).
      await new Promise((resolve) => {
        setTimeout(resolve, 300)
      })
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    })
  })
})
