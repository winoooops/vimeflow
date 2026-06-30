// cspell:ignore worktree testids worktrees
import userEvent from '@testing-library/user-event'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { writeClipboardText } from '@/lib/clipboard'
import { GitRefChip, composeCopyRows } from './GitRefChip'

vi.mock('@/lib/clipboard', () => ({
  writeClipboardText: vi.fn().mockResolvedValue(true),
}))

let restorePlatform: (() => void) | null = null

const setNavigatorPlatform = (platform: string): void => {
  restorePlatform?.()
  const original = Object.getOwnPropertyDescriptor(window.navigator, 'platform')

  Object.defineProperty(window.navigator, 'platform', {
    configurable: true,
    value: platform,
  })

  restorePlatform = (): void => {
    if (original === undefined) {
      delete (window.navigator as unknown as { platform?: string }).platform

      return
    }

    Object.defineProperty(window.navigator, 'platform', original)
  }
}

const installNativeOverlayBridge = (): {
  open: ReturnType<typeof vi.fn>
} => {
  const open = vi.fn().mockResolvedValue({ accepted: true })

  window.vimeflow = {
    invoke: <T,>(): Promise<T> => Promise.resolve(null as T),
    listen: vi.fn(() => Promise.resolve(vi.fn())),
    nativeOverlay: {
      open,
      close: vi.fn().mockResolvedValue(undefined),
      actionResult: vi.fn().mockResolvedValue(undefined),
      onAction: vi.fn(() => vi.fn()),
      onClose: vi.fn(() => vi.fn()),
    },
  }

  return { open }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  restorePlatform?.()
  restorePlatform = null
  delete window.vimeflow
})

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

test('chip frame caps at its container so the branch can ellipsis-truncate', () => {
  render(<GitRefChip worktreeName="feat-jose" branch="feat/jose-auth" />)
  const chip = screen.getByTestId('git-ref-chip')

  expect(chip.className).toMatch(/min-w-0/)
  expect(chip.className).toMatch(/max-w-full/)
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

test('collapsibleWorktree hides the worktree segment in a narrow container', () => {
  render(
    <GitRefChip worktreeName="feat-jose" branch="main" collapsibleWorktree />
  )

  expect(screen.getByTestId('git-ref-chip-wt-icon').className).toMatch(
    /@max-\[280px\]:hidden/
  )

  expect(screen.getByTestId('git-ref-chip-wt-label').className).toMatch(
    /@max-\[280px\]:hidden/
  )

  expect(screen.getByTestId('git-ref-chip-chevron').className).toMatch(
    /@max-\[280px\]:hidden/
  )
})

test('worktree segment stays put without collapsibleWorktree', () => {
  render(<GitRefChip worktreeName="feat-jose" branch="main" />)

  expect(screen.getByTestId('git-ref-chip-wt-label').className).not.toMatch(
    /@max-\[280px\]:hidden/
  )
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
  expect(chip.className).toMatch(/focus-visible:outline-none/)
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

test('GitRefChip opens the copy menu from keyboard focus', async () => {
  const user = userEvent.setup()
  render(
    <GitRefChip
      worktreeName="feat-jose"
      branch="feat/jose-auth"
      cwd="/Users/will/projects/vimeflow/.claude/worktrees/feat-jose"
    />
  )

  await user.tab()

  expect(screen.getByTestId('git-ref-chip')).toHaveAttribute('tabindex', '0')
  expect(
    screen.getByRole('menu', { name: 'Git ref details' })
  ).toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: 'Copy worktree' })).toHaveFocus()
  expect(
    screen.getByRole('menuitem', { name: 'Copy path' })
  ).toBeInTheDocument()
})

test('GitRefChip closes on Escape without reopening from restored focus', async () => {
  const user = userEvent.setup()
  render(
    <GitRefChip
      worktreeName="feat-jose"
      branch="feat/jose-auth"
      cwd="/Users/will/projects/vimeflow/.claude/worktrees/feat-jose"
    />
  )

  await user.tab()
  expect(
    screen.getByRole('menu', { name: 'Git ref details' })
  ).toBeInTheDocument()

  await user.keyboard('{Escape}')

  await waitFor(() => {
    expect(screen.queryByRole('menu', { name: 'Git ref details' })).toBeNull()
  })

  expect(screen.getByTestId('git-ref-chip')).toHaveAttribute(
    'aria-expanded',
    'false'
  )
})

test('GitRefChip copies the selected row through the menu', async () => {
  vi.mocked(writeClipboardText).mockClear()
  render(
    <GitRefChip
      worktreeName="feat-jose"
      branch="feat/jose-auth"
      cwd="/Users/will/projects/vimeflow/.claude/worktrees/feat-jose"
    />
  )

  fireEvent.click(screen.getByTestId('git-ref-chip'))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Copy path' }))

  await waitFor(() =>
    expect(writeClipboardText).toHaveBeenCalledWith(
      '/Users/will/projects/vimeflow/.claude/worktrees/feat-jose'
    )
  )

  expect(
    screen.getByRole('menu', { name: 'Git ref details' })
  ).toBeInTheDocument()

  expect(screen.getByRole('menuitem', { name: 'Copy path' })).toHaveTextContent(
    'check'
  )
})

test('GitRefChip sends native overlay rows with chip-width matching', async () => {
  vi.stubEnv('VITE_NATIVE_OVERLAY', '1')
  setNavigatorPlatform('MacIntel')
  const nativeBridge = installNativeOverlayBridge()

  render(
    <GitRefChip
      worktreeName="native-overlay-git-ref"
      branch="codex/native-overlay-git-ref"
      cwd="/Users/will/projects/vimeflow/worktrees/native-overlay-git-ref"
      nativeOverlay
    />
  )

  const chip = screen.getByTestId('git-ref-chip')
  vi.spyOn(chip, 'getBoundingClientRect').mockReturnValue({
    x: 7,
    y: 11,
    width: 238,
    height: 22,
    top: 11,
    left: 7,
    right: 245,
    bottom: 33,
    toJSON: () => ({}),
  } as DOMRect)

  fireEvent.keyDown(chip, { key: 'ArrowDown' })

  await waitFor(() => expect(nativeBridge.open).toHaveBeenCalledOnce())

  const request = nativeBridge.open.mock.calls[0][0] as {
    anchorRect: { x: number; y: number; width: number; height: number }
    payload: {
      matchAnchorWidth?: boolean
      surfaceTone?: string
      items?: readonly {
        label?: string
        detail?: string
        icon?: string
        feedback?: string
        closeOnSelect?: boolean
      }[]
    }
  }

  expect(screen.queryByRole('menu', { name: 'Git ref details' })).toBeNull()
  expect(request).toMatchObject({
    anchorRect: { x: 7, y: 11, width: 238, height: 22 },
    payload: {
      matchAnchorWidth: true,
      surfaceTone: 'primary-container-soft',
      items: expect.arrayContaining([
        expect.objectContaining({
          label: 'Copy path',
          detail:
            '/Users/will/projects/vimeflow/worktrees/native-overlay-git-ref',
          icon: 'folder_open',
          feedback: 'copy',
          closeOnSelect: false,
        }),
      ]),
    },
  })
})

test('GitRefChip does not open the native overlay from focus restoration', () => {
  vi.stubEnv('VITE_NATIVE_OVERLAY', '1')
  setNavigatorPlatform('MacIntel')
  const nativeBridge = installNativeOverlayBridge()

  render(
    <GitRefChip
      worktreeName="native-overlay-git-ref"
      branch="codex/native-overlay-git-ref"
      nativeOverlay
    />
  )

  fireEvent.focus(screen.getByTestId('git-ref-chip'))

  expect(nativeBridge.open).not.toHaveBeenCalled()
})
