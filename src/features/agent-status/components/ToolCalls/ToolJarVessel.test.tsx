import { afterEach, describe, expect, test, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import type { ToolJarEntry } from '../../types'
import { ToolJarVessel } from './ToolJarVessel'

const tools: ToolJarEntry[] = [
  { name: 'exec_command', count: 542 },
  { name: 'write_stdin', count: 32 },
  { name: 'apply_patch', count: 28 },
]

const originalRO = global.ResizeObserver

afterEach(() => {
  global.ResizeObserver = originalRO
})

describe('ToolJarVessel', () => {
  test('renders the recessed tank at the given height', () => {
    render(<ToolJarVessel tools={tools} max={542} height={180} />)
    const vessel = screen.getByTestId('tool-jar-vessel')

    expect(vessel).toBeInTheDocument()
    expect(vessel.style.height).toBe('180px')
  })

  test('packs one tile per tool once a width is measured', () => {
    let trigger: (() => void) | null = null
    global.ResizeObserver = vi.fn().mockImplementation((cb: () => void) => {
      trigger = cb

      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() }
    }) as unknown as typeof ResizeObserver

    render(<ToolJarVessel tools={tools} max={542} height={180} />)
    const vessel = screen.getByTestId('tool-jar-vessel')
    Object.defineProperty(vessel, 'clientWidth', {
      configurable: true,
      value: 248,
    })

    act(() => {
      trigger?.()
    })

    for (const tool of tools) {
      expect(
        screen.getByTestId(`tool-jar-tile-${tool.name}`)
      ).toBeInTheDocument()
    }
  })
})
