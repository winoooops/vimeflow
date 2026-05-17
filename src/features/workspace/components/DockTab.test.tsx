import { render, screen, within } from '@testing-library/react'
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
    expect(diffTab).toHaveClass('bg-[rgba(226,199,255,0.08)]')
    expect(diffTab).toHaveClass('border-[rgba(203,166,247,0.3)]')
    expect(diffTab).toHaveClass('text-[#e2c7ff]')
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
})
