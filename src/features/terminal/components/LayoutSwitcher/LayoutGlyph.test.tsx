/* eslint-disable testing-library/no-container, testing-library/no-node-access */
// cspell:ignore vsplit hsplit
import { render } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { LayoutId } from '../../../sessions/types'
import { LayoutGlyph } from './LayoutGlyph'

const lineCount = (svg: SVGElement): number =>
  svg.querySelectorAll('line').length

const cases: readonly (readonly [LayoutId, number])[] = [
  ['single', 0],
  ['vsplit', 1],
  ['hsplit', 1],
  ['threeRight', 2],
  ['quad', 2],
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
})
