// cspell:ignore worktree testids worktrees
import userEvent from '@testing-library/user-event'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { writeClipboardText } from '@/lib/clipboard'
import { GitRefChip, GitRefCopyRows, composeCopyRows } from './GitRefChip'

vi.mock('@/lib/clipboard', () => ({
  writeClipboardText: vi.fn().mockResolvedValue(true),
}))

test('renders nothing when branch is null', () => {
  render(<GitRefChip worktreeName="feat-jose" branch={null} />)
  expect(screen.queryByTestId('git-ref-chip')).toBeNull()
})

test('renders nothing when branch is empty string', () => {
  render(<GitRefChip worktreeName="feat-jose" branch="" />)
  expect(screen.queryByTestId('git-ref-chip')).toBeNull()
})

test('renders all six testids when worktreeName and branch are present', () => {
  render(<GitRefChip worktreeName="feat-jose" branch="feat/jose-auth" />)
  expect(screen.getByTestId('git-ref-chip')).toBeInTheDocument()
  expect(screen.getByTestId('git-ref-chip-wt-icon')).toBeInTheDocument()
  expect(screen.getByTestId('git-ref-chip-wt-label')).toHaveTextContent(
    'feat-jose'
  )
  expect(screen.getByTestId('git-ref-chip-chevron')).toBeInTheDocument()
  expect(screen.getByTestId('git-ref-chip-br-icon')).toBeInTheDocument()
  expect(screen.getByTestId('git-ref-chip-br-label')).toHaveTextContent(
    'feat/jose-auth'
  )
})

test('renders branch-only when worktreeName is null', () => {
  render(<GitRefChip worktreeName={null} branch="main" />)
  expect(screen.getByTestId('git-ref-chip')).toBeInTheDocument()
  expect(screen.queryByTestId('git-ref-chip-wt-icon')).toBeNull()
  expect(screen.queryByTestId('git-ref-chip-wt-label')).toBeNull()
  expect(screen.queryByTestId('git-ref-chip-chevron')).toBeNull()
  expect(screen.getByTestId('git-ref-chip-br-icon')).toBeInTheDocument()
  expect(screen.getByTestId('git-ref-chip-br-label')).toHaveTextContent('main')
})

test('branch label has min-w-0 truncate classes', () => {
  render(<GitRefChip worktreeName="feat-jose" branch="feat/jose-auth" />)
  expect(screen.getByTestId('git-ref-chip-br-label').className).toMatch(
    /min-w-0/
  )

  expect(screen.getByTestId('git-ref-chip-br-label').className).toMatch(
    /truncate/
  )
})

test('worktree label has max-w-[120px] + truncate + shrink-0 classes', () => {
  render(
    <GitRefChip
      worktreeName="this-is-a-very-long-worktree-name-for-test"
      branch="feat/jose-auth"
    />
  )
  const wtLabel = screen.getByTestId('git-ref-chip-wt-label')
  expect(wtLabel.className).toMatch(/max-w-\[120px\]/)
  expect(wtLabel.className).toMatch(/truncate/)
  expect(wtLabel.className).toMatch(/shrink-0/)
})

test('detached=true applies two-tone coral (text-tertiary branch, text-error worktree)', () => {
  // Two-tone coral matches docs/design/git-chip/GitRefChip.html:
  //   - branch icon + label render in `text-tertiary` (deeper coral)
  //   - worktree icon + label render in `text-error` (lighter coral)
  // `text-error` is intentionally NOT Catppuccin red — this repo's `error`
  // token maps to a coral shade (see tailwind.config.js).
  render(<GitRefChip worktreeName="feat-jose" branch="a7f23c" detached />)
  const chip = screen.getByTestId('git-ref-chip')
  expect(chip.className).toMatch(/bg-tertiary\/\[0\.06\]/)
  expect(chip.className).toMatch(/border-tertiary/)
  expect(screen.getByTestId('git-ref-chip-br-label').className).toMatch(
    /text-tertiary/
  )

  expect(screen.getByTestId('git-ref-chip-wt-label').className).toMatch(
    /text-error/
  )
})

test('detached=true with worktreeName=null renders coral branch-only chip', () => {
  render(<GitRefChip worktreeName={null} branch="a7f23c" detached />)
  const chip = screen.getByTestId('git-ref-chip')
  expect(chip.className).toMatch(/bg-tertiary\/\[0\.06\]/)
  expect(screen.queryByTestId('git-ref-chip-wt-icon')).toBeNull()
  expect(screen.queryByTestId('git-ref-chip-wt-label')).toBeNull()
  expect(screen.getByTestId('git-ref-chip-br-label')).toHaveTextContent(
    'a7f23c'
  )
})

test('composeCopyRows produces the right rows for every state', () => {
  // The copy popover only renders on hover via a portal, so the per-state row
  // contract — which rows show, their order, icons, labels and two-tone
  // detached colors — is locked via this pure function (same rationale as the
  // old composeTooltipLines wording test). Order is always worktree (if any) →
  // path (if cwd) → branch (always).

  // Branch only — single branch row, attached colors.
  expect(composeCopyRows(null, 'feat/jose-auth', null, false)).toEqual([
    {
      key: 'branch',
      icon: 'fork_right',
      iconClassName: 'text-primary-container',
      label: 'branch',
      value: 'feat/jose-auth',
    },
  ])

  // Branch + worktree (no cwd) — worktree first, branch last.
  expect(composeCopyRows('feat-jose', 'feat/jose-auth', null, false)).toEqual([
    {
      key: 'worktree',
      icon: 'account_tree',
      iconClassName: 'text-secondary-dim',
      label: 'worktree',
      value: 'feat-jose',
    },
    {
      key: 'branch',
      icon: 'fork_right',
      iconClassName: 'text-primary-container',
      label: 'branch',
      value: 'feat/jose-auth',
    },
  ])

  // Full three rows: worktree, path (the real absolute cwd), branch.
  expect(
    composeCopyRows(
      'feat-jose',
      'feat/jose-auth',
      '/Users/will/projects/vimeflow/.claude/worktrees/feat-jose',
      false
    )
  ).toEqual([
    {
      key: 'worktree',
      icon: 'account_tree',
      iconClassName: 'text-secondary-dim',
      label: 'worktree',
      value: 'feat-jose',
    },
    {
      key: 'path',
      icon: 'folder_open',
      iconClassName: 'text-on-surface-variant',
      label: 'path',
      value: '/Users/will/projects/vimeflow/.claude/worktrees/feat-jose',
    },
    {
      key: 'branch',
      icon: 'fork_right',
      iconClassName: 'text-primary-container',
      label: 'branch',
      value: 'feat/jose-auth',
    },
  ])

  // No worktree + cwd — worktree row omitted, path falls in.
  expect(
    composeCopyRows(
      null,
      'ci/release-v0.9',
      '/Users/will/projects/vimeflow',
      false
    )
  ).toEqual([
    {
      key: 'path',
      icon: 'folder_open',
      iconClassName: 'text-on-surface-variant',
      label: 'path',
      value: '/Users/will/projects/vimeflow',
    },
    {
      key: 'branch',
      icon: 'fork_right',
      iconClassName: 'text-primary-container',
      label: 'branch',
      value: 'ci/release-v0.9',
    },
  ])

  // Detached — branch label reads "detached head"; two-tone coral icons
  // (worktree text-error, branch text-tertiary) mirroring the chip.
  expect(
    composeCopyRows(
      'tests',
      'a7f23c0',
      '/Users/will/projects/vimeflow/.claude/worktrees/tests',
      true
    )
  ).toEqual([
    {
      key: 'worktree',
      icon: 'account_tree',
      iconClassName: 'text-error',
      label: 'worktree',
      value: 'tests',
    },
    {
      key: 'path',
      icon: 'folder_open',
      iconClassName: 'text-on-surface-variant',
      label: 'path',
      value: '/Users/will/projects/vimeflow/.claude/worktrees/tests',
    },
    {
      key: 'branch',
      icon: 'fork_right',
      iconClassName: 'text-tertiary',
      label: 'detached head',
      value: 'a7f23c0',
    },
  ])
})

test('icons carry material-symbols-outlined class + aria-hidden', () => {
  render(<GitRefChip worktreeName="feat-jose" branch="feat/jose-auth" />)
  const wtIcon = screen.getByTestId('git-ref-chip-wt-icon')
  const brIcon = screen.getByTestId('git-ref-chip-br-icon')

  expect(wtIcon.className).toMatch(/material-symbols-outlined/)
  expect(brIcon.className).toMatch(/material-symbols-outlined/)
  expect(wtIcon.getAttribute('aria-hidden')).toBe('true')
  expect(brIcon.getAttribute('aria-hidden')).toBe('true')
})

test('GitRefChip opens the copy popover from keyboard focus', async () => {
  const user = userEvent.setup()
  render(
    <GitRefChip
      worktreeName="feat-jose"
      branch="feat/jose-auth"
      cwd="/Users/will/projects/vimeflow/.claude/worktrees/feat-jose"
    />
  )

  await user.tab()

  expect(screen.getByTestId('git-ref-chip')).toHaveFocus()
  expect(screen.getByTestId('git-ref-chip')).toHaveAttribute('tabindex', '0')
  expect(
    screen.getByRole('dialog', { name: 'Git ref details' })
  ).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Copy path' })).toBeInTheDocument()
})

test('GitRefCopyRows renders one copy button per row carrying its value', () => {
  render(
    <GitRefCopyRows
      worktreeName="feat-jose"
      branch="feat/jose-auth"
      cwd="/Users/will/projects/vimeflow/.claude/worktrees/feat-jose"
    />
  )

  expect(
    screen.getByRole('button', { name: 'Copy worktree' })
  ).toHaveTextContent('feat-jose')

  expect(screen.getByRole('button', { name: 'Copy path' })).toHaveTextContent(
    '/Users/will/projects/vimeflow/.claude/worktrees/feat-jose'
  )

  expect(screen.getByRole('button', { name: 'Copy branch' })).toHaveTextContent(
    'feat/jose-auth'
  )
})

test('GitRefCopyRows omits the worktree row when there is no worktree', () => {
  render(
    <GitRefCopyRows
      worktreeName={null}
      branch="ci/release-v0.9"
      cwd="/Users/will/projects/vimeflow"
    />
  )
  expect(screen.queryByRole('button', { name: 'Copy worktree' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Copy path' })).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Copy branch' })
  ).toBeInTheDocument()
})

test('GitRefCopyRows omits the path row when there is no cwd', () => {
  render(<GitRefCopyRows worktreeName="feat-jose" branch="main" cwd={null} />)
  expect(screen.queryByRole('button', { name: 'Copy path' })).toBeNull()
  expect(
    screen.getByRole('button', { name: 'Copy worktree' })
  ).toBeInTheDocument()

  expect(
    screen.getByRole('button', { name: 'Copy branch' })
  ).toBeInTheDocument()
})

test('GitRefCopyRows labels the branch row "Copy detached head" when detached', () => {
  render(
    <GitRefCopyRows worktreeName={null} branch="a7f23c0" cwd={null} detached />
  )

  expect(
    screen.getByRole('button', { name: 'Copy detached head' })
  ).toHaveTextContent('a7f23c0')
})

test('clicking a row copies its value and flips that row glyph to a check', async () => {
  vi.mocked(writeClipboardText).mockClear()
  render(
    <GitRefCopyRows
      worktreeName="feat-jose"
      branch="feat/jose-auth"
      cwd="/Users/will/projects/vimeflow/.claude/worktrees/feat-jose"
    />
  )
  const pathButton = screen.getByRole('button', { name: 'Copy path' })
  expect(within(pathButton).getByText('content_copy')).toBeInTheDocument()

  fireEvent.click(pathButton)

  await waitFor(() =>
    expect(writeClipboardText).toHaveBeenCalledWith(
      '/Users/will/projects/vimeflow/.claude/worktrees/feat-jose'
    )
  )
  expect(await within(pathButton).findByText('check')).toBeInTheDocument()
  // Other rows are unaffected — only the clicked row shows the check.
  expect(
    within(screen.getByRole('button', { name: 'Copy branch' })).getByText(
      'content_copy'
    )
  ).toBeInTheDocument()
})

test('copy failure keeps the row glyph on content_copy', async () => {
  vi.mocked(writeClipboardText).mockResolvedValueOnce(false)
  render(<GitRefCopyRows worktreeName={null} branch="main" cwd={null} />)
  const branchButton = screen.getByRole('button', { name: 'Copy branch' })

  fireEvent.click(branchButton)

  await waitFor(() => expect(writeClipboardText).toHaveBeenCalledWith('main'))
  expect(within(branchButton).queryByText('check')).toBeNull()
  expect(within(branchButton).getByText('content_copy')).toBeInTheDocument()
})

test('the copied check reverts to content_copy after the feedback window', async () => {
  vi.useFakeTimers()
  try {
    vi.mocked(writeClipboardText).mockClear()
    render(
      <GitRefCopyRows
        worktreeName={null}
        branch="main"
        cwd="/Users/will/projects/vimeflow"
      />
    )
    const pathButton = screen.getByRole('button', { name: 'Copy path' })

    fireEvent.click(pathButton)
    await act(async () => {
      await Promise.resolve()
    })
    expect(writeClipboardText).toHaveBeenCalled()
    expect(within(pathButton).getByText('check')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1300)
    })

    expect(within(pathButton).getByText('content_copy')).toBeInTheDocument()
  } finally {
    vi.useRealTimers()
  }
})
