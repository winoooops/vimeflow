// cspell:ignore worktree testids
import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { GitRefChip } from './GitRefChip'

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

test('detached=true applies coral classes to chip frame, branch label, worktree label', () => {
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

test('title attribute composition for all four states', () => {
  const { rerender } = render(
    <GitRefChip worktreeName="feat-jose" branch="feat/jose-auth" />
  )
  expect(screen.getByTestId('git-ref-chip').getAttribute('title')).toBe(
    'worktree: feat-jose · branch: feat/jose-auth'
  )

  rerender(<GitRefChip worktreeName={null} branch="feat/jose-auth" />)
  expect(screen.getByTestId('git-ref-chip').getAttribute('title')).toBe(
    'branch: feat/jose-auth'
  )

  rerender(<GitRefChip worktreeName="feat-jose" branch="a7f23c" detached />)
  expect(screen.getByTestId('git-ref-chip').getAttribute('title')).toBe(
    'worktree: feat-jose · detached HEAD: a7f23c'
  )

  rerender(<GitRefChip worktreeName={null} branch="a7f23c" detached />)
  expect(screen.getByTestId('git-ref-chip').getAttribute('title')).toBe(
    'detached HEAD: a7f23c'
  )
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
