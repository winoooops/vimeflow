import { describe, test, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { UnsavedChangesDialog } from './UnsavedChangesDialog'

describe('UnsavedChangesDialog', () => {
  test('renders nothing when isOpen is false', () => {
    render(
      <UnsavedChangesDialog
        // eslint-disable-next-line react/jsx-boolean-value
        isOpen={false}
        fileName="example.ts"
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    // Should not render dialog when closed
    expect(
      screen.queryByRole('dialog', { name: /unsaved changes/i })
    ).not.toBeInTheDocument()
  })

  test('renders dialog when isOpen is true', () => {
    render(
      <UnsavedChangesDialog
        isOpen
        fileName="example.ts"
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByText(/example\.ts/i)).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /unsaved changes/i })
    ).toBeInTheDocument()
  })

  test('displays file name in dialog content', () => {
    render(
      <UnsavedChangesDialog
        isOpen
        fileName="my-file.rs"
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByText(/my-file\.rs/i)).toBeInTheDocument()
  })

  test('calls onSave when Save button is clicked', () => {
    const onSave = vi.fn()

    render(
      <UnsavedChangesDialog
        isOpen
        fileName="example.ts"
        onSave={onSave}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    const saveButton = screen.getByRole('button', { name: /save/i })
    fireEvent.click(saveButton)

    expect(onSave).toHaveBeenCalledTimes(1)
  })

  test('calls onDiscard when Discard button is clicked', () => {
    const onDiscard = vi.fn()

    render(
      <UnsavedChangesDialog
        isOpen
        fileName="example.ts"
        onSave={vi.fn()}
        onDiscard={onDiscard}
        onCancel={vi.fn()}
      />
    )

    const discardButton = screen.getByRole('button', { name: /discard/i })
    fireEvent.click(discardButton)

    expect(onDiscard).toHaveBeenCalledTimes(1)
  })

  test('calls onCancel when Cancel button is clicked', () => {
    const onCancel = vi.fn()

    render(
      <UnsavedChangesDialog
        isOpen
        fileName="example.ts"
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        onCancel={onCancel}
      />
    )

    const cancelButton = screen.getByRole('button', { name: /cancel/i })
    fireEvent.click(cancelButton)

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  test('calls onCancel when Escape key is pressed', () => {
    const onCancel = vi.fn()

    render(
      <UnsavedChangesDialog
        isOpen
        fileName="example.ts"
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        onCancel={onCancel}
      />
    )

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  test('renders dialog with aria attributes', () => {
    render(
      <UnsavedChangesDialog
        isOpen
        fileName="example.ts"
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    // Verify dialog is rendered with correct accessibility attributes
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-label', 'Unsaved changes dialog')
  })

  test('renders three buttons in correct order', () => {
    render(
      <UnsavedChangesDialog
        isOpen
        fileName="example.ts"
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(3)
    expect(buttons[0]).toHaveTextContent(/save/i)
    expect(buttons[1]).toHaveTextContent(/discard/i)
    expect(buttons[2]).toHaveTextContent(/cancel/i)
  })
})
