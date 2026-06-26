import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { PathCrumb } from './PathCrumb'

describe('PathCrumb', () => {
  test('renders each segment; last segment is emphasized', () => {
    render(<PathCrumb path="~/code/vimeflow-core" />)
    expect(screen.getByText('~')).toBeInTheDocument()
    expect(screen.getByText('code')).toBeInTheDocument()
    const last = screen.getByText('vimeflow-core')
    expect(last).toHaveClass('text-primary')
  })

  test('renders a / fallback segment for bare root path', () => {
    render(<PathCrumb path="/" />)
    const segment = screen.getByText('/')
    expect(segment).toBeInTheDocument()
    expect(segment).toHaveClass('text-primary')
  })
})
