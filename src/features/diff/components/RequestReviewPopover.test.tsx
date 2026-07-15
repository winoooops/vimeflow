import { test, expect, vi } from 'vitest'
import { fireEvent, render as rtlRender, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RequestReviewPopover } from './RequestReviewPopover'
import type { PaneCandidate, ResolveResult } from '../services/activePanePicker'
import type { RequestReviewScopeControl } from './RequestReviewPopover'
import type { ReactElement, ReactNode } from 'react'
import type { AppSettings } from '../../../bindings/AppSettings'
import { SettingsContext } from '../../settings/SettingsProvider'
import { DEFAULT_SETTINGS } from '../../settings/store/settingsDefaults'

const render = (
  ui: ReactElement,
  customKeybindings: Record<string, string> = {}
): ReturnType<typeof rtlRender> => {
  const settings: AppSettings = { ...DEFAULT_SETTINGS, customKeybindings }

  return rtlRender(ui, {
    wrapper: ({ children }: { children: ReactNode }): ReactElement => (
      <SettingsContext.Provider
        value={{ settings, saveError: null, update: vi.fn() }}
      >
        {children}
      </SettingsContext.Provider>
    ),
  })
}

const createAnchor = (): HTMLDivElement => {
  const el = document.createElement('div')
  document.body.appendChild(el)

  return el
}

const makePane = (overrides: Partial<PaneCandidate> = {}): PaneCandidate => ({
  paneId: 'pane-1',
  ptyId: 'pty-1',
  tabName: 'Tab 1',
  agentLabel: 'Claude Code',
  cwd: '/repo',
  status: 'running',
  isFocused: false,
  ...overrides,
})

test('kind none shows no-agent copy; Copy and Dismiss fire their handlers', async () => {
  const user = userEvent.setup()
  const anchor = createAnchor()
  const onCopy = vi.fn()
  const onCancel = vi.fn()
  const onSubmit = vi.fn()

  render(
    <RequestReviewPopover
      anchor={anchor}
      result={{ kind: 'none' } as ResolveResult}
      scopeLabel="src/auth.ts (unstaged)"
      onSubmit={onSubmit}
      onCopy={onCopy}
      onCancel={onCancel}
    />
  )

  expect(
    screen.getByRole('dialog', { name: 'Request review' })
  ).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Copy (C)' }))
  expect(onCopy).toHaveBeenCalledTimes(1)

  await user.click(screen.getByRole('button', { name: 'Dismiss (N)' }))
  expect(onCancel).toHaveBeenCalledTimes(1)
  expect(onSubmit).not.toHaveBeenCalled()

  anchor.remove()
})

test('kind one shows the scope label + pane, and Delegate submits the pane', async () => {
  const user = userEvent.setup()
  const anchor = createAnchor()
  const onSubmit = vi.fn()
  const onCancel = vi.fn()
  const pane = makePane({ tabName: 'codex', agentLabel: 'Codex' })

  render(
    <RequestReviewPopover
      anchor={anchor}
      result={{ kind: 'one', pane } as ResolveResult}
      scopeLabel="src/auth.ts (unstaged)"
      onSubmit={onSubmit}
      onCopy={vi.fn()}
      onCancel={onCancel}
    />
  )

  expect(
    screen.getByText(
      /Delegate a code review of src\/auth\.ts \(unstaged\) to codex \(Codex\)\?/
    )
  ).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Delegate (Shift+Y)' }))
  expect(onSubmit).toHaveBeenCalledTimes(1)
  expect(onSubmit).toHaveBeenCalledWith(pane)

  await user.click(screen.getByRole('button', { name: 'Cancel (N)' }))
  expect(onCancel).toHaveBeenCalledTimes(1)

  anchor.remove()
})

test('kind one accepts Shift+Y to delegate and n to cancel', async () => {
  const user = userEvent.setup()
  const anchor = createAnchor()
  const onSubmit = vi.fn()
  const onCancel = vi.fn()
  const pane = makePane()

  render(
    <RequestReviewPopover
      anchor={anchor}
      result={{ kind: 'one', pane } as ResolveResult}
      scopeLabel="this file"
      onSubmit={onSubmit}
      onCopy={vi.fn()}
      onCancel={onCancel}
    />
  )

  fireEvent.keyDown(document, { key: 'Y', code: 'KeyY', shiftKey: true })
  expect(onSubmit).toHaveBeenCalledWith(pane)

  await user.keyboard('n')
  expect(onCancel).toHaveBeenCalledTimes(1)

  anchor.remove()
})

test('kind many shows copy-only (no picker) — review targets one bound agent', async () => {
  const user = userEvent.setup()
  const anchor = createAnchor()
  const onCopy = vi.fn()
  const onSubmit = vi.fn()

  const paneA = makePane({ ptyId: 'pty-a', tabName: 'claude-a' })
  const paneB = makePane({ ptyId: 'pty-b', tabName: 'codex-b' })

  render(
    <RequestReviewPopover
      anchor={anchor}
      result={{ kind: 'many', candidates: [paneA, paneB] } as ResolveResult}
      scopeLabel="src/auth.ts (staged)"
      onSubmit={onSubmit}
      onCopy={onCopy}
      onCancel={vi.fn()}
    />
  )

  // No per-pane picker: multiple agents fall back to copy, not a chooser.
  expect(screen.queryByRole('button', { name: 'Delegate' })).toBeNull()

  await user.click(screen.getByRole('button', { name: 'Copy (C)' }))
  expect(onCopy).toHaveBeenCalledTimes(1)
  expect(onSubmit).not.toHaveBeenCalled()

  anchor.remove()
})

test('the c key copies the review request', async () => {
  const user = userEvent.setup()
  const anchor = createAnchor()
  const onCopy = vi.fn()

  render(
    <RequestReviewPopover
      anchor={anchor}
      result={{ kind: 'none' } as ResolveResult}
      scopeLabel="this file"
      onSubmit={vi.fn()}
      onCopy={onCopy}
      onCancel={vi.fn()}
    />
  )

  await user.keyboard('c')
  expect(onCopy).toHaveBeenCalledTimes(1)

  anchor.remove()
})

test('renders the scope control with both options when provided', () => {
  const onScopeChange = vi.fn()

  const scopeControl: RequestReviewScopeControl = {
    scope: 'changelist',
    changeCount: 7,
    fileDisabled: false,
    changelistDisabled: false,
    onScopeChange,
  }
  const anchor = createAnchor()

  render(
    <RequestReviewPopover
      anchor={anchor}
      result={{ kind: 'none' } as ResolveResult}
      scopeLabel="7 changes"
      scopeControl={scopeControl}
      onSubmit={vi.fn()}
      onCopy={vi.fn()}
      onCancel={vi.fn()}
    />
  )

  const group = screen.getByRole('group', { name: 'Review scope' })
  expect(group).toBeInTheDocument()

  const fileBtn = screen.getByRole('button', { name: 'This file' })
  const changelistBtn = screen.getByRole('button', { name: 'All changes' })
  expect(fileBtn).toBeInTheDocument()
  expect(changelistBtn).toBeInTheDocument()
  // 'changelist' is the active scope — it should have aria-pressed=true
  expect(changelistBtn).toHaveAttribute('aria-pressed', 'true')
  expect(fileBtn).toHaveAttribute('aria-pressed', 'false')

  anchor.remove()
})

test('custom scope hotkeys replace the defaults', () => {
  const onScopeChange = vi.fn()

  const scopeControl: RequestReviewScopeControl = {
    scope: 'changelist',
    changeCount: 3,
    fileDisabled: false,
    changelistDisabled: false,
    onScopeChange,
  }
  const anchor = createAnchor()

  render(
    <RequestReviewPopover
      anchor={anchor}
      result={{ kind: 'none' } as ResolveResult}
      scopeLabel="3 changes"
      scopeControl={scopeControl}
      onSubmit={vi.fn()}
      onCopy={vi.fn()}
      onCancel={vi.fn()}
    />,
    {
      'diff-request-review-scope-file': 'Alt+KeyF',
      'diff-request-review-scope-changelist': 'Alt+KeyA',
    }
  )

  fireEvent.keyDown(document, { key: 'f', code: 'KeyF' })
  fireEvent.keyDown(document, { key: 'a', code: 'KeyA' })
  expect(onScopeChange).not.toHaveBeenCalled()

  fireEvent.keyDown(document, { key: 'f', code: 'KeyF', altKey: true })
  expect(onScopeChange).toHaveBeenCalledWith('file')
  onScopeChange.mockClear()

  fireEvent.keyDown(document, { key: 'a', code: 'KeyA', altKey: true })
  expect(onScopeChange).toHaveBeenCalledWith('changelist')

  anchor.remove()
})

test('scope control absent when scopeControl is undefined', () => {
  const anchor = createAnchor()

  render(
    <RequestReviewPopover
      anchor={anchor}
      result={{ kind: 'none' } as ResolveResult}
      scopeLabel="this file"
      onSubmit={vi.fn()}
      onCopy={vi.fn()}
      onCancel={vi.fn()}
    />
  )

  expect(screen.queryByRole('group', { name: 'Review scope' })).toBeNull()

  anchor.remove()
})

test('This file option is disabled without an active diff', () => {
  const onScopeChange = vi.fn()

  const scopeControl: RequestReviewScopeControl = {
    scope: 'changelist',
    changeCount: 5,
    fileDisabled: true,
    changelistDisabled: false,
    onScopeChange,
  }
  const anchor = createAnchor()

  render(
    <RequestReviewPopover
      anchor={anchor}
      result={{ kind: 'none' } as ResolveResult}
      scopeLabel="5 changes"
      scopeControl={scopeControl}
      onSubmit={vi.fn()}
      onCopy={vi.fn()}
      onCancel={vi.fn()}
    />
  )

  const fileBtn = screen.getByRole('button', { name: 'This file' })
  expect(fileBtn).toHaveAttribute('aria-disabled', 'true')

  // pressing f must NOT call onScopeChange when fileDisabled is true
  fireEvent.keyDown(document, { key: 'f', code: 'KeyF' })
  expect(onScopeChange).not.toHaveBeenCalled()

  anchor.remove()
})

test('All changes option is disabled on an empty strip', () => {
  const onScopeChange = vi.fn()

  const scopeControl: RequestReviewScopeControl = {
    scope: 'file',
    changeCount: 0,
    fileDisabled: false,
    changelistDisabled: true,
    onScopeChange,
  }
  const anchor = createAnchor()

  render(
    <RequestReviewPopover
      anchor={anchor}
      result={{ kind: 'none' } as ResolveResult}
      scopeLabel="this file"
      scopeControl={scopeControl}
      onSubmit={vi.fn()}
      onCopy={vi.fn()}
      onCancel={vi.fn()}
    />
  )

  const changelistBtn = screen.getByRole('button', { name: 'All changes' })
  expect(changelistBtn).toHaveAttribute('aria-disabled', 'true')

  // pressing a must NOT call onScopeChange when changelistDisabled is true
  fireEvent.keyDown(document, { key: 'a', code: 'KeyA' })
  expect(onScopeChange).not.toHaveBeenCalled()

  anchor.remove()
})

test('uses customized request-review actions and hints', () => {
  const anchor = createAnchor()
  const pane = makePane()
  const onCopy = vi.fn()
  const onCancel = vi.fn()
  const onSubmit = vi.fn()

  render(
    <RequestReviewPopover
      anchor={anchor}
      result={{ kind: 'one', pane } as ResolveResult}
      scopeLabel="this file"
      onSubmit={onSubmit}
      onCopy={onCopy}
      onCancel={onCancel}
    />,
    {
      'diff-review-copy': 'Alt+KeyC',
      'diff-confirm-cancel': 'Alt+Escape',
      'diff-request-review-submit': 'Alt+Enter',
    }
  )

  expect(screen.getByRole('button', { name: 'Copy (Alt+C)' })).toHaveAttribute(
    'aria-keyshortcuts',
    'Alt+c'
  )

  expect(
    screen.getByRole('button', { name: 'Cancel (Alt+Escape)' })
  ).toHaveAttribute('aria-keyshortcuts', 'Alt+Escape')

  expect(
    screen.getByRole('button', { name: 'Delegate (Alt+Enter)' })
  ).toHaveAttribute('aria-keyshortcuts', 'Alt+Enter')

  fireEvent.keyDown(document, { key: 'c', code: 'KeyC' })
  fireEvent.keyDown(document, { key: 'n', code: 'KeyN' })
  fireEvent.keyDown(document, { key: 'Y', code: 'KeyY', shiftKey: true })
  expect(onCopy).not.toHaveBeenCalled()
  expect(onCancel).not.toHaveBeenCalled()
  expect(onSubmit).not.toHaveBeenCalled()

  fireEvent.keyDown(document, { key: 'c', code: 'KeyC', altKey: true })
  fireEvent.keyDown(document, { key: 'Enter', code: 'Enter', altKey: true })
  fireEvent.keyDown(document, { key: 'Escape', code: 'Escape', altKey: true })
  expect(onCopy).toHaveBeenCalledOnce()
  expect(onSubmit).toHaveBeenCalledWith(pane)
  expect(onCancel).toHaveBeenCalledOnce()

  anchor.remove()
})
