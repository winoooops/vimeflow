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
})
