/* eslint-disable testing-library/no-container, testing-library/no-node-access */
// cspell:ignore vsplit hsplit
import { render } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { LayoutId } from '../../../sessions/types'
import type { PaneLayoutDefinition } from '../../layout-registry'
import { LayoutGlyph } from './LayoutGlyph'

const lineCount = (svg: SVGElement): number =>
  svg.querySelectorAll('line').length

const cases: readonly (readonly [LayoutId, number])[] = [
  ['single', 0],
  ['vsplit', 1],
  ['hsplit', 1],
  ['threeRight', 2],
  ['quad', 2],
  ['grid3x2', 3],
]

describe('LayoutGlyph', () => {
  test.each(cases)(
    'renders %s with %i line separators',
    (layoutId, expectedLines) => {
      const { container } = render(<LayoutGlyph layoutId={layoutId} />)
      const svg = container.querySelector('svg')

      expect(svg).not.toBeNull()
      expect(lineCount(svg as SVGElement)).toBe(expectedLines)
      expect(svg!.querySelectorAll('rect')).toHaveLength(1)
    }
  )

  test('renders custom glyph slots from track units instead of equal cells', () => {
    const definition: PaneLayoutDefinition = {
      schemaVersion: 1,
      id: 'custom:main-side',
      title: 'Main side',
      source: 'workspace',
      tracks: {
        columns: [
          { id: 'col-0', units: 16 },
          { id: 'col-1', units: 8 },
        ],
        rows: [{ id: 'row-0', units: 24 }],
      },
      slots: [
        { id: 'slot:p0', rect: { col: 0, row: 0, colSpan: 1, rowSpan: 1 } },
        { id: 'slot:p1', rect: { col: 1, row: 0, colSpan: 1, rowSpan: 1 } },
      ],
      addOrder: ['slot:p0', 'slot:p1'],
    }

    const { container } = render(
      <LayoutGlyph layoutId="custom:main-side" definition={definition} />
    )
    const rects = Array.from(container.querySelectorAll('rect'))

    expect(rects).toHaveLength(2)
    expect(rects[0]).toHaveAttribute('width', '8')
    expect(rects[1]).toHaveAttribute('width', '4')
  })
})
