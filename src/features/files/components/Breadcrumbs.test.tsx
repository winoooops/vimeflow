import { render, screen } from '@testing-library/react'
import { describe, test, expect } from 'vitest'
import { Breadcrumbs } from './Breadcrumbs'

describe('Breadcrumbs', () => {
  test('renders navigation element', () => {
    render(<Breadcrumbs segments={['vibm-project', 'src', 'components']} />)

    const nav = screen.getByRole('navigation', {
      name: /file path breadcrumbs/i,
    })
    expect(nav).toBeInTheDocument()
  })

  test('renders all segments', () => {
    render(<Breadcrumbs segments={['vibm-project', 'src', 'components']} />)

    expect(screen.getByText('vibm-project')).toBeInTheDocument()
    expect(screen.getByText('src')).toBeInTheDocument()
    expect(screen.getByText('components')).toBeInTheDocument()
  })

  test('separates segments with forward slash', () => {
    render(<Breadcrumbs segments={['vibm-project', 'src', 'components']} />)

    const separators = screen.getAllByText('/')
    expect(separators).toHaveLength(2) // 3 segments = 2 separators
  })

  test('last segment has different styling', () => {
    render(<Breadcrumbs segments={['vibm-project', 'src', 'components']} />)

    const lastSegment = screen.getByText('components')
    expect(lastSegment).toHaveClass('text-on-surface', 'font-semibold')
  })

  test('non-last segments have variant styling', () => {
    render(<Breadcrumbs segments={['vibm-project', 'src', 'components']} />)

    const firstSegment = screen.getByText('vibm-project')
    expect(firstSegment).toHaveClass('text-on-surface-variant')
    expect(firstSegment).not.toHaveClass('font-semibold')
  })

  test('renders single segment without separator', () => {
    render(<Breadcrumbs segments={['vibm-project']} />)

    expect(screen.getByText('vibm-project')).toBeInTheDocument()
    expect(screen.queryByText('/')).not.toBeInTheDocument()
  })

  test('renders empty array gracefully', () => {
    render(<Breadcrumbs segments={[]} />)

    const nav = screen.getByRole('navigation', {
      name: /file path breadcrumbs/i,
    })
    expect(nav).toBeInTheDocument()
    expect(nav).toBeEmptyDOMElement()
  })
})
