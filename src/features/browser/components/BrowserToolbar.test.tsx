import { test, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BrowserToolbar, type BrowserToolbarProps } from './BrowserToolbar'

const baseProps: BrowserToolbarProps = {
  committedUrl: 'https://example.com/',
  draft: 'https://example.com/',
  isEditing: false,
  onBeginEdit: () => undefined,
  onDraftChange: () => undefined,
  onSubmit: () => undefined,
  onCancel: () => undefined,
  onOpenExternal: () => undefined,
  canOpenExternal: true,
  canGoBack: false,
  canGoForward: false,
  isLoading: false,
  onBack: () => undefined,
  onForward: () => undefined,
  onReloadOrStop: () => undefined,
}

test('back / forward are disabled without history; reload is enabled', () => {
  render(<BrowserToolbar {...baseProps} />)

  expect(screen.getByRole('button', { name: 'back' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'forward' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'reload' })).not.toBeDisabled()
})

test('back / forward enable from canGo* and fire their handlers', () => {
  const onBack = vi.fn()
  const onForward = vi.fn()
  render(
    <BrowserToolbar
      {...baseProps}
      canGoBack
      canGoForward
      onBack={onBack}
      onForward={onForward}
    />
  )

  const back = screen.getByRole('button', { name: 'back' })
  const forward = screen.getByRole('button', { name: 'forward' })
  expect(back).not.toBeDisabled()
  expect(forward).not.toBeDisabled()

  fireEvent.click(back)
  fireEvent.click(forward)
  expect(onBack).toHaveBeenCalledOnce()
  expect(onForward).toHaveBeenCalledOnce()
})

test('reload button toggles to stop while loading', () => {
  const onReloadOrStop = vi.fn()

  const { rerender } = render(
    <BrowserToolbar {...baseProps} onReloadOrStop={onReloadOrStop} />
  )

  fireEvent.click(screen.getByRole('button', { name: 'reload' }))
  expect(onReloadOrStop).toHaveBeenCalledOnce()
  expect(screen.queryByRole('button', { name: 'stop' })).toBeNull()

  rerender(
    <BrowserToolbar {...baseProps} isLoading onReloadOrStop={onReloadOrStop} />
  )

  expect(screen.getByRole('button', { name: 'stop' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'reload' })).toBeNull()
})

test('open-external fires when there is an active URL', () => {
  const onOpenExternal = vi.fn()
  render(<BrowserToolbar {...baseProps} onOpenExternal={onOpenExternal} />)

  fireEvent.click(
    screen.getByRole('button', { name: 'open in system browser' })
  )
  expect(onOpenExternal).toHaveBeenCalledOnce()
})

test('open-external is disabled when canOpenExternal is false', () => {
  const disabledProps = { ...baseProps, canOpenExternal: false }
  render(<BrowserToolbar {...disabledProps} />)

  expect(
    screen.getByRole('button', { name: 'open in system browser' })
  ).toBeDisabled()
})

test('hosts the address bar', () => {
  render(<BrowserToolbar {...baseProps} />)

  expect(
    screen.getByRole('button', { name: /address bar/ })
  ).toBeInTheDocument()
})
