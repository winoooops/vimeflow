// cspell:ignore vdiv hdiv
import { render, screen, fireEvent } from '@testing-library/react'
import { test, expect, vi, describe } from 'vitest'
import { ResizeHandle, type ResizeHandleProps } from './ResizeHandle'

const baseProps: ResizeHandleProps = {
  orientation: 'horizontal',
  isDragging: false,
  ariaValueNow: 100,
  ariaValueMin: 40,
  ariaValueMax: 640,
  onMouseDown: vi.fn(),
  onKeyDown: vi.fn(),
}

describe('ResizeHandle', () => {
  test('renders a separator with the given orientation', () => {
    render(<ResizeHandle {...baseProps} orientation="vertical" />)
    const handle = screen.getByTestId('resize-handle')
    expect(handle).toHaveAttribute('role', 'separator')
    expect(handle).toHaveAttribute('aria-orientation', 'vertical')
  })

  test('horizontal orientation uses ns-resize, vertical uses col-resize', () => {
    const { rerender } = render(
      <ResizeHandle {...baseProps} orientation="horizontal" />
    )
    expect(screen.getByTestId('resize-handle').className).toMatch(
      /cursor-ns-resize/
    )
    rerender(<ResizeHandle {...baseProps} orientation="vertical" />)
    expect(screen.getByTestId('resize-handle').className).toMatch(
      /cursor-col-resize/
    )
  })

  test('exposes aria value range', () => {
    render(
      <ResizeHandle
        {...baseProps}
        ariaValueNow={120}
        ariaValueMin={50}
        ariaValueMax={900}
      />
    )
    const handle = screen.getByTestId('resize-handle')
    expect(handle).toHaveAttribute('aria-valuenow', '120')
    expect(handle).toHaveAttribute('aria-valuemin', '50')
    expect(handle).toHaveAttribute('aria-valuemax', '900')
  })

  test('applies the active background only while dragging', () => {
    const { rerender } = render(<ResizeHandle {...baseProps} />)
    expect(screen.getByTestId('resize-handle').className).not.toMatch(
      /bg-primary\/30/
    )
    rerender(<ResizeHandle {...baseProps} isDragging />)
    expect(screen.getByTestId('resize-handle').className).toMatch(
      /bg-primary\/30/
    )
  })

  test('forwards mouse + keyboard events', () => {
    const onMouseDown = vi.fn()
    const onKeyDown = vi.fn()
    render(
      <ResizeHandle
        {...baseProps}
        onMouseDown={onMouseDown}
        onKeyDown={onKeyDown}
      />
    )
    const handle = screen.getByTestId('resize-handle')
    fireEvent.mouseDown(handle)
    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    expect(onMouseDown).toHaveBeenCalled()
    expect(onKeyDown).toHaveBeenCalled()
  })

  test('passes through consumer className, style and testId', () => {
    render(
      <ResizeHandle
        {...baseProps}
        testId="split-resize-handle"
        className="absolute z-10 h-1 left-0 right-0"
        style={{ gridArea: 'vdiv' }}
      />
    )
    const handle = screen.getByTestId('split-resize-handle')
    expect(handle.className).toMatch(/\bz-10\b/)
    expect(handle.className).toMatch(/left-0/)
    expect(handle.style.gridArea).toBe('vdiv')
  })
})
