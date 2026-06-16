import { describe, test, expect } from 'vitest'
import { type ReactElement } from 'react'
import { render, screen } from '@testing-library/react'
import { SurfacePanel } from './SurfacePanel'
import { useFloatingSurface } from './useFloatingSurface'

const Harness = ({
  focus = false,
}: {
  focus?: false | { initialFocus?: number }
}): ReactElement => {
  const fs = useFloatingSurface({ open: true, onOpenChange: () => undefined })

  return (
    <SurfacePanel
      setFloating={fs.refs.setFloating}
      style={fs.floatingStyles}
      context={fs.context}
      focus={focus}
      {...fs.getFloatingProps()}
    >
      <button type="button">Item</button>
    </SurfacePanel>
  )
}

describe('SurfacePanel', () => {
  test('renders children on the canonical glass chrome (portaled)', () => {
    render(<Harness />)
    const item = screen.getByRole('button', { name: 'Item' })
    // eslint-disable-next-line testing-library/no-node-access -- verifying the glass-panel chrome class on the portaled wrapper
    const panel = item.closest('div')
    expect(panel?.className).toContain('rounded-lg')
    expect(panel?.className).toContain('backdrop-blur-md')
  })
})
