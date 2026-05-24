// cspell:ignore worktree testids worktrees
import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { GitRefChip, composeTooltipLines } from './GitRefChip'

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
  //   - branch icon + label render in `text-tertiary` (#ff94a5, deeper coral)
  //   - worktree icon + label render in `text-error` (#ffb4ab, lighter coral)
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

test('composeTooltipLines produces the right lines for every state', () => {
  // The chip wraps its content in <Tooltip>, which only renders the floating
  // surface on hover/focus via a portal. Asserting the per-state lines
  // against the rendered DOM would require driving floating-ui's hover state
  // through fake timers. The wording is pulled out into a pure function so
  // the contract stays locked without that machinery.

  // Branch only (no worktree, no cwd, attached) — single line.
  expect(composeTooltipLines(null, 'feat/jose-auth', null, false)).toEqual([
    'branch: feat/jose-auth',
  ])

  // Branch + worktree — branch first, worktree second.
  expect(
    composeTooltipLines('feat-jose', 'feat/jose-auth', null, false)
  ).toEqual(['branch: feat/jose-auth', 'worktree: feat-jose'])

  // Detached SHA only.
  expect(composeTooltipLines(null, 'a7f23c', null, true)).toEqual([
    'detached HEAD: a7f23c',
  ])

  // Detached + worktree — detached HEAD line first.
  expect(composeTooltipLines('feat-jose', 'a7f23c', null, true)).toEqual([
    'detached HEAD: a7f23c',
    'worktree: feat-jose',
  ])

  // Branch + cwd (no worktree) — cwd appears verbatim on line 2.
  expect(
    composeTooltipLines(null, 'main', '/home/will/projects/foo', false)
  ).toEqual(['branch: main', '/home/will/projects/foo'])

  // Full three-line tooltip: branch, worktree, cwd path (verbatim, no `~`).
  expect(
    composeTooltipLines(
      'git-chip-migration',
      'feat/git-chip-migration',
      '/home/will/projects/vimeflow/.claude/worktrees/git-chip-migration',
      false
    )
  ).toEqual([
    'branch: feat/git-chip-migration',
    'worktree: git-chip-migration',
    '/home/will/projects/vimeflow/.claude/worktrees/git-chip-migration',
  ])

  // Non-home absolute path passes through unchanged.
  expect(composeTooltipLines(null, 'main', '/opt/code/proj', false)).toEqual([
    'branch: main',
    '/opt/code/proj',
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
