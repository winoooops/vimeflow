import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { getCommand, type CommandId } from '@/features/keymap/catalog'
import type { Keybindings } from '@/features/keymap/useKeybindings'
import { resolveDefault } from '@/features/keymap/resolve'
import type { ChangedFile } from '../types'
import { ChangedFilesList, ChangedFilesListSurface } from './ChangedFilesList'

const bindingFor: Keybindings['bindingFor'] = (id: CommandId) =>
  resolveDefault(getCommand(id), false)

describe('ChangedFilesList', () => {
  const mockFiles: ChangedFile[] = [
    {
      path: 'src/components/NavBar.tsx',
      status: 'modified',
      insertions: 12,
      deletions: 3,
      staged: false,
    },
    {
      path: 'src/utils/api-helper.rs',
      status: 'added',
      insertions: 45,
      deletions: 0,
      staged: true,
    },
    {
      path: 'tsconfig.json',
      status: 'deleted',
      insertions: 0,
      deletions: 18,
      staged: false,
    },
  ]

  test('renders CHANGED FILES header', () => {
    render(
      <ChangedFilesList
        bindingFor={bindingFor}
        files={mockFiles}
        selectedFile={null}
        onSelectFile={vi.fn()}
      />
    )

    const header = screen.getByText(/Changed Files/i)

    expect(header).toBeInTheDocument()
    expect(header).toHaveClass('text-on-surface-variant')
  })

  test('renders file list with status glyphs, names, and directories', () => {
    render(
      <ChangedFilesList
        bindingFor={bindingFor}
        files={mockFiles}
        selectedFile={null}
        onSelectFile={vi.fn()}
      />
    )

    expect(screen.getByText(/NavBar\.tsx/)).toBeInTheDocument()
    expect(screen.getByText(/api-helper\.rs/)).toBeInTheDocument()
    expect(screen.getByText(/tsconfig\.json/)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /comment on file/i })
    ).not.toBeInTheDocument()

    expect(screen.getByLabelText('Modified')).toHaveTextContent('M')
    expect(screen.getByLabelText('Added')).toHaveTextContent('A')
    expect(screen.getByLabelText('Deleted')).toHaveTextContent('D')
    expect(screen.getByText('src/components')).toBeInTheDocument()
  })

  test('displays insertion and deletion counts', () => {
    render(
      <ChangedFilesList
        bindingFor={bindingFor}
        files={mockFiles}
        selectedFile={null}
        onSelectFile={vi.fn()}
      />
    )

    // NavBar: +12 -3
    expect(screen.getByText('+12')).toBeInTheDocument()
    expect(screen.getByText('-3')).toBeInTheDocument()

    // api-helper: +45 -0
    expect(screen.getByText('+45')).toBeInTheDocument()

    // tsconfig: +0 -18
    expect(screen.getByText('-18')).toBeInTheDocument()
  })

  test('scrolls the newly selected row into view, once per selection change', () => {
    let scrollContainer: HTMLElement | null = null

    const scrollSpy = vi
      .spyOn(Element.prototype, 'scrollIntoView')
      .mockImplementation(function (this: Element) {
        void this
      })

    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        if (this.dataset.testid === 'changed-files-scroll-container') {
          return new DOMRect(0, 0, 0, 40)
        }

        const currentScroll = scrollContainer?.scrollTop ?? 0

        if (this.textContent?.includes('NavBar.tsx')) {
          return new DOMRect(0, 80 - currentScroll, 0, 20)
        }

        if (this.textContent?.includes('tsconfig.json')) {
          return new DOMRect(0, 120 - currentScroll, 0, 20)
        }

        return new DOMRect(0, 0, 0, 0)
      })

    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.dataset.testid === 'changed-files-scroll-container' ? 40 : 0
      })

    const { rerender } = render(
      <ChangedFilesList
        bindingFor={bindingFor}
        files={mockFiles}
        selectedFile={{ path: 'src/components/NavBar.tsx', staged: false }}
        onSelectFile={vi.fn()}
      />
    )

    scrollContainer = screen.getByTestId('changed-files-scroll-container')

    // Opening the list does not scroll; only later n/p selection changes do.
    expect(scrollContainer.scrollTop).toBe(0)
    expect(scrollSpy).not.toHaveBeenCalled()

    // n/p moved the selection from outside the list → the NEW row scrolls
    // (the deselected row must not).
    rerender(
      <ChangedFilesList
        bindingFor={bindingFor}
        files={mockFiles}
        selectedFile={{ path: 'tsconfig.json', staged: false }}
        onSelectFile={vi.fn()}
      />
    )
    expect(scrollContainer.scrollTop).toBe(100)

    // Unrelated re-render with the same selection: no extra scroll.
    rerender(
      <ChangedFilesList
        bindingFor={bindingFor}
        files={mockFiles}
        selectedFile={{ path: 'tsconfig.json', staged: false }}
        onSelectFile={vi.fn()}
      />
    )
    expect(scrollContainer.scrollTop).toBe(100)

    clientHeightSpy.mockRestore()
    rectSpy.mockRestore()
    scrollSpy.mockRestore()
  })

  test('applies active file highlighting when selected', () => {
    render(
      <ChangedFilesList
        bindingFor={bindingFor}
        files={mockFiles}
        selectedFile={{ path: 'src/components/NavBar.tsx', staged: false }}
        onSelectFile={vi.fn()}
      />
    )

    const activeFile = screen.getByRole('button', {
      name: /NavBar\.tsx/i,
      current: 'page',
    })

    expect(activeFile).toHaveAttribute('aria-current', 'page')
  })

  test('pin button toggles the pinned state when provided', async () => {
    const user = userEvent.setup()
    const onTogglePinned = vi.fn()

    render(
      <ChangedFilesList
        bindingFor={bindingFor}
        files={mockFiles}
        selectedFile={null}
        onSelectFile={vi.fn()}
        onTogglePinned={onTogglePinned}
      />
    )

    const pinButton = screen.getByRole('button', { name: /pin changed files/i })

    expect(pinButton).toHaveAttribute('aria-keyshortcuts', 'Shift+E')

    await user.click(pinButton)

    expect(onTogglePinned).toHaveBeenCalledOnce()
  })

  test('shows resolved pin and file-comment shortcuts', () => {
    const remappedBindingFor: Keybindings['bindingFor'] = (id) => {
      if (id === 'diff-files-pin') {
        return { code: 'ArrowDown', mods: new Set(['Shift']) }
      }
      if (id === 'diff-comment-file') {
        return { code: 'ArrowUp', mods: new Set(['Alt']) }
      }

      return bindingFor(id)
    }

    render(
      <ChangedFilesList
        bindingFor={remappedBindingFor}
        files={mockFiles}
        selectedFile={null}
        onSelectFile={vi.fn()}
        onAddFileComment={vi.fn()}
        onTogglePinned={vi.fn()}
      />
    )

    expect(
      screen.getByRole('button', { name: /pin changed files/i })
    ).toHaveAttribute('aria-keyshortcuts', 'Shift+ArrowDown')

    expect(
      screen.getByRole('button', { name: 'Comment on file NavBar.tsx' })
    ).toHaveAttribute('aria-keyshortcuts', 'Alt+ArrowUp')
  })

  test('calls onSelectFile when file is clicked', async () => {
    const handleSelect = vi.fn()
    const user = userEvent.setup()

    render(
      <ChangedFilesList
        bindingFor={bindingFor}
        files={mockFiles}
        selectedFile={null}
        onSelectFile={handleSelect}
      />
    )

    const navBarFile = screen.getByText(/NavBar\.tsx/)

    await user.click(navBarFile)

    expect(handleSelect).toHaveBeenCalledWith(mockFiles[0])
  })

  test('calls onAddFileComment from the file comment affordance without selecting the file', async () => {
    const handleSelect = vi.fn()
    const handleAddFileComment = vi.fn()
    const user = userEvent.setup()

    render(
      <ChangedFilesList
        bindingFor={bindingFor}
        files={mockFiles}
        selectedFile={null}
        onSelectFile={handleSelect}
        onAddFileComment={handleAddFileComment}
      />
    )

    await user.click(
      screen.getByRole('button', {
        name: 'Comment on file NavBar.tsx',
      })
    )

    expect(handleAddFileComment).toHaveBeenCalledWith(
      mockFiles[0],
      expect.any(HTMLElement)
    )
    expect(handleSelect).not.toHaveBeenCalled()
  })

  test('renders files in the order provided (sorting done by parent)', () => {
    const orderedFiles: ChangedFile[] = [
      {
        path: 'modified.ts',
        status: 'modified',
        insertions: 10,
        deletions: 2,
        staged: false,
      },
      {
        path: 'added.rs',
        status: 'added',
        insertions: 20,
        deletions: 0,
        staged: false,
      },
      {
        path: 'deleted.txt',
        status: 'deleted',
        insertions: 0,
        deletions: 5,
        staged: false,
      },
    ]

    render(
      <ChangedFilesList
        bindingFor={bindingFor}
        files={orderedFiles}
        selectedFile={null}
        onSelectFile={vi.fn()}
      />
    )

    const fileNames = screen
      .getAllByRole('button')
      .map((btn) => btn.textContent)

    // Renders in the order given
    expect(fileNames[0]).toContain('modified.ts')
    expect(fileNames[1]).toContain('added.rs')
    expect(fileNames[2]).toContain('deleted.txt')
  })

  test('applies hover state styling', () => {
    render(
      <ChangedFilesList
        bindingFor={bindingFor}
        files={mockFiles}
        selectedFile={null}
        onSelectFile={vi.fn()}
      />
    )

    const fileButton = screen.getByRole('button', {
      name: /NavBar\.tsx/i,
    })

    // eslint-disable-next-line testing-library/no-node-access -- row wrapper owns the hover background class
    const row = fileButton.parentElement

    expect(row?.className).toContain('hover:bg-surface-container-high/60')
  })

  test('truncates long file paths', () => {
    const longPathFile: ChangedFile[] = [
      {
        path: 'src/features/diff/components/very/deep/nested/path/SomeComponent.tsx',
        status: 'modified',
        insertions: 5,
        deletions: 2,
        staged: false,
      },
    ]

    render(
      <ChangedFilesList
        bindingFor={bindingFor}
        files={longPathFile}
        selectedFile={null}
        onSelectFile={vi.fn()}
      />
    )

    const fileName = screen.getByText(/SomeComponent\.tsx/)

    // Check truncate class is applied
    expect(fileName).toHaveClass('truncate')
  })

  test('renders a trailing-slash path label without collapsing to blank', () => {
    const directoryLikePath: ChangedFile[] = [
      {
        path: '.vimeflow/',
        status: 'untracked',
        staged: false,
      },
    ]

    render(
      <ChangedFilesList
        bindingFor={bindingFor}
        files={directoryLikePath}
        selectedFile={null}
        onSelectFile={vi.fn()}
      />
    )

    expect(screen.getByText('.vimeflow')).toBeInTheDocument()
  })

  test('renders empty state when no files', () => {
    render(
      <ChangedFilesList
        bindingFor={bindingFor}
        files={[]}
        selectedFile={null}
        onSelectFile={vi.fn()}
      />
    )

    const header = screen.getByText(/Changed Files/i)

    expect(header).toBeInTheDocument()

    // No file buttons should be rendered
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  test('uses correct color for insertions (green) and deletions (red)', () => {
    const { container } = render(
      <ChangedFilesList
        bindingFor={bindingFor}
        files={mockFiles}
        selectedFile={null}
        onSelectFile={vi.fn()}
      />
    )

    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const insertionText = container.querySelector('.text-vcs-added')

    expect(insertionText).toBeInTheDocument()

    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const deletionText = container.querySelector('.text-vcs-deleted')

    expect(deletionText).toBeInTheDocument()
  })

  test('MM/AM disambiguation: renders two rows for files with same path but different staged flags', async () => {
    const mmFiles: ChangedFile[] = [
      {
        path: 'src/both.ts',
        status: 'modified',
        insertions: 10,
        deletions: 5,
        staged: true,
      },
      {
        path: 'src/both.ts',
        status: 'modified',
        insertions: 3,
        deletions: 1,
        staged: false,
      },
    ]

    const onSelect = vi.fn()
    const user = userEvent.setup()

    render(
      <ChangedFilesList
        bindingFor={bindingFor}
        files={mmFiles}
        selectedFile={null}
        onSelectFile={onSelect}
      />
    )

    // Two rows with the same filename
    const fileButtons = screen.getAllByText('both.ts')

    expect(fileButtons).toHaveLength(2)

    // Clicking each row calls onSelect with the correct file
    await user.click(fileButtons[0])
    expect(onSelect).toHaveBeenCalledWith(mmFiles[0])

    await user.click(fileButtons[1])
    expect(onSelect).toHaveBeenCalledWith(mmFiles[1])
  })

  test('uses unique row keys for MM/AM files (no key collision)', () => {
    const mmFiles: ChangedFile[] = [
      {
        path: 'src/both.ts',
        status: 'modified',
        insertions: 10,
        deletions: 5,
        staged: true,
      },
      {
        path: 'src/both.ts',
        status: 'modified',
        insertions: 3,
        deletions: 1,
        staged: false,
      },
    ]

    render(
      <ChangedFilesList
        bindingFor={bindingFor}
        files={mmFiles}
        selectedFile={null}
        onSelectFile={vi.fn()}
      />
    )

    // Both rows should render (no key collision causes React to drop one)
    const fileButtons = screen.getAllByText('both.ts')

    expect(fileButtons).toHaveLength(2)
  })
})

describe('ChangedFilesListSurface', () => {
  const mockFiles: ChangedFile[] = [
    {
      path: 'src/components/NavBar.tsx',
      status: 'modified',
      insertions: 12,
      deletions: 3,
      staged: false,
    },
  ]

  test('keeps the panel open when activating after focus reveal', async () => {
    const user = userEvent.setup()
    const onReveal = vi.fn()
    const onToggle = vi.fn()
    const unpinned = false
    const hidden = false

    const remappedBindingFor: Keybindings['bindingFor'] = (id) =>
      id === 'diff-files-toggle'
        ? { code: 'ArrowLeft', mods: new Set(['Shift']) }
        : bindingFor(id)

    render(
      <ChangedFilesListSurface
        bindingFor={remappedBindingFor}
        files={mockFiles}
        selectedFile={null}
        pinned={unpinned}
        revealed={hidden}
        onReveal={onReveal}
        onToggle={onToggle}
        onScheduleHide={vi.fn()}
        onTogglePinned={vi.fn()}
        onSelectFile={vi.fn()}
        onAddFileComment={vi.fn()}
      />
    )

    const edgeHint = screen.getByRole('button', {
      name: /show changed files \(1\)/i,
    })
    expect(edgeHint).toHaveAttribute('aria-keyshortcuts', 'Shift+ArrowLeft')

    await user.click(edgeHint)

    expect(onReveal).toHaveBeenCalled()
    expect(onToggle).not.toHaveBeenCalled()
  })

  test('schedules hide only after focus leaves the unpinned surface', async () => {
    const user = userEvent.setup()
    const onScheduleHide = vi.fn()
    const unpinned = false
    const shown = true

    render(
      <>
        <ChangedFilesListSurface
          bindingFor={bindingFor}
          files={mockFiles}
          selectedFile={null}
          pinned={unpinned}
          revealed={shown}
          onReveal={vi.fn()}
          onToggle={vi.fn()}
          onScheduleHide={onScheduleHide}
          onTogglePinned={vi.fn()}
          onSelectFile={vi.fn()}
          onAddFileComment={vi.fn()}
        />
        <button type="button">Outside diff</button>
      </>
    )

    await user.tab()
    expect(
      screen.getByRole('button', { name: /hide changed files \(1\)/i })
    ).toHaveFocus()

    await user.tab()
    expect(
      screen.getByRole('button', { name: /pin changed files/i })
    ).toHaveFocus()
    expect(onScheduleHide).not.toHaveBeenCalled()

    await user.tab()
    expect(
      screen.getAllByRole('button', { name: /NavBar\.tsx/i })[0]
    ).toHaveFocus()
    expect(onScheduleHide).not.toHaveBeenCalled()

    await user.tab()
    expect(
      screen.getByRole('button', { name: /comment on file/i })
    ).toHaveFocus()
    expect(onScheduleHide).not.toHaveBeenCalled()

    await user.tab()
    expect(screen.getByRole('button', { name: /outside diff/i })).toHaveFocus()
    expect(onScheduleHide).toHaveBeenCalledOnce()
  })
})
