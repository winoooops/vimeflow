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
}

test('back / forward / reload render disabled', () => {
  render(<BrowserToolbar {...baseProps} />)

  for (const label of ['back', 'forward', 'reload']) {
    expect(screen.getByRole('button', { name: label })).toBeDisabled()
  }
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
