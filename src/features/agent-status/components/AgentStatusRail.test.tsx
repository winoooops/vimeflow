import type { ReactElement, ReactNode } from 'react'
import { render, screen, within } from '@testing-library/react'
import { test, expect, vi } from 'vitest'
import { AgentStatusRail } from './AgentStatusRail'
import { ctxTone } from '../utils/contextTone'

const tooltipPropsSpy = vi.hoisted(() => vi.fn())

vi.mock('@/components/Tooltip', () => ({
  Tooltip: (props: {
    children: ReactElement
    content: ReactNode
    nativeOverlay?: boolean
  }): ReactElement => {
    tooltipPropsSpy(props)

    return props.children
  },
}))

test('renders context and cache meters without an agent glyph', () => {
  render(<AgentStatusRail contextUsedPercentage={42} cacheHitPercentage={75} />)

  expect(screen.queryByTestId('agent-glyph-chip')).not.toBeInTheDocument()
  expect(screen.getByRole('meter', { name: 'CTX' })).toHaveAttribute(
    'aria-valuenow',
    '42'
  )

  expect(screen.getByRole('meter', { name: 'CACHE' })).toHaveAttribute(
    'aria-valuenow',
    '75'
  )
})

test('routes collapsed context and cache labels through the native overlay', () => {
  tooltipPropsSpy.mockClear()
  render(<AgentStatusRail contextUsedPercentage={42} cacheHitPercentage={75} />)

  expect(tooltipPropsSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      content: 'Context: 42%',
      nativeOverlay: true,
    })
  )

  expect(tooltipPropsSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      content: 'Current cache rate: 75%',
      nativeOverlay: true,
    })
  )
})

// The context meter shares the continuous ctxTone sweep with the expanded
// reservoir card so the context color agrees across collapsed + expanded
// states — no more tiered token swaps.
test('context meter color follows the shared ctxTone sweep', () => {
  const { rerender } = render(
    <AgentStatusRail contextUsedPercentage={92} cacheHitPercentage={null} />
  )

  expect(
    within(screen.getByRole('meter', { name: 'CTX' })).getByText('%')
  ).toHaveStyle({ color: ctxTone(92).base })

  rerender(
    <AgentStatusRail contextUsedPercentage={40} cacheHitPercentage={null} />
  )

  expect(
    within(screen.getByRole('meter', { name: 'CTX' })).getByText('%')
  ).toHaveStyle({ color: ctxTone(40).base })
})

test('hides context meter when contextUsedPercentage is null', () => {
  render(
    <AgentStatusRail contextUsedPercentage={null} cacheHitPercentage={null} />
  )

  expect(screen.queryByRole('meter', { name: 'CTX' })).not.toBeInTheDocument()
})

test('hides cache meter when cacheHitPercentage is null', () => {
  render(
    <AgentStatusRail contextUsedPercentage={50} cacheHitPercentage={null} />
  )

  expect(screen.queryByRole('meter', { name: 'CACHE' })).not.toBeInTheDocument()
})

test('cache ring tone is mint at >=70%, lavender 40-70%, coral <40%', () => {
  const { rerender } = render(
    <AgentStatusRail contextUsedPercentage={null} cacheHitPercentage={85} />
  )

  expect(screen.getByTestId('cache-ring-arc')).toHaveAttribute(
    'stroke',
    'var(--color-success-muted)'
  )

  rerender(
    <AgentStatusRail contextUsedPercentage={null} cacheHitPercentage={55} />
  )

  expect(screen.getByTestId('cache-ring-arc')).toHaveAttribute(
    'stroke',
    'var(--color-primary)'
  )

  rerender(
    <AgentStatusRail contextUsedPercentage={null} cacheHitPercentage={20} />
  )

  expect(screen.getByTestId('cache-ring-arc')).toHaveAttribute(
    'stroke',
    'var(--color-tertiary)'
  )
})

test('renders the cache rate as a ring, not the liquid bar', () => {
  render(<AgentStatusRail contextUsedPercentage={42} cacheHitPercentage={75} />)

  const cacheMeter = screen.getByRole('meter', { name: 'CACHE' })

  expect(within(cacheMeter).getByTestId('cache-ring-arc')).toBeInTheDocument()
  expect(
    within(cacheMeter).queryByTestId('liquid-base')
  ).not.toBeInTheDocument()
})

test('drops the visible CACHE caption from the rail ring', () => {
  render(
    <AgentStatusRail contextUsedPercentage={null} cacheHitPercentage={75} />
  )

  // The label now lives only in the tooltip + accessible name, not on the ring.
  expect(
    within(screen.getByRole('meter', { name: 'CACHE' })).queryByText('CACHE')
  ).not.toBeInTheDocument()
})

test('rail is 44px wide', () => {
  render(
    <AgentStatusRail contextUsedPercentage={50} cacheHitPercentage={null} />
  )

  expect(screen.getByTestId('agent-status-rail')).toHaveStyle({ width: '44px' })
})

test('rail sits on the canvas surface token', () => {
  render(
    <AgentStatusRail contextUsedPercentage={50} cacheHitPercentage={null} />
  )

  const rail = screen.getByTestId('agent-status-rail')

  expect(rail.className).toContain('bg-surface')
  expect(rail.className).not.toContain('bg-surface-container')
})

test('adds macOS drag coverage with a no-drag clearance for the floating toggle', () => {
  render(
    <AgentStatusRail
      contextUsedPercentage={50}
      cacheHitPercentage={null}
      reserveWindowControls
    />
  )

  expect(screen.getByTestId('agent-status-rail')).toHaveClass(
    'vf-app-drag-region'
  )

  expect(screen.getByTestId('activity-toggle-clearance')).toHaveClass(
    'vf-app-no-drag'
  )
})

test('omits the drag clearance when native controls are not reserved', () => {
  render(
    <AgentStatusRail contextUsedPercentage={50} cacheHitPercentage={null} />
  )

  expect(
    screen.queryByTestId('activity-toggle-clearance')
  ).not.toBeInTheDocument()
})

test('does not add rail drag coverage when native controls are not reserved', () => {
  render(
    <AgentStatusRail contextUsedPercentage={50} cacheHitPercentage={null} />
  )

  expect(screen.getByTestId('agent-status-rail')).not.toHaveClass(
    'vf-app-drag-region'
  )
})
