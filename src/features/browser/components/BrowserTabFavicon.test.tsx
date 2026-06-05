import { test, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BrowserTabFavicon } from './BrowserTabFavicon'

// alt="" makes the img decorative (no `img` role) — query it by its test id.
test('renders an img when favicon is set', () => {
  render(
    <BrowserTabFavicon
      favicon="data:image/png;base64,AAAA"
      url="https://x.com/"
    />
  )

  expect(screen.getByTestId('browser-tab-favicon')).toHaveAttribute(
    'src',
    'data:image/png;base64,AAAA'
  )
})

test('renders the placeholder glyph when favicon is null', () => {
  render(<BrowserTabFavicon favicon={null} url="https://x.com/pull/1" />)
  expect(screen.getByText('merge')).toBeInTheDocument()
  expect(screen.queryByTestId('browser-tab-favicon')).toBeNull()
})

test('falls back to the placeholder when the img errors', () => {
  render(
    <BrowserTabFavicon
      favicon="data:image/png;base64,bad"
      url="https://x.com/issues"
    />
  )
  fireEvent.error(screen.getByTestId('browser-tab-favicon'))
  expect(screen.getByText('adjust')).toBeInTheDocument()
})

test('resets the img error state when the favicon prop changes', () => {
  const { rerender } = render(
    <BrowserTabFavicon
      favicon="data:image/png;base64,bad"
      url="https://x.com/"
    />
  )
  fireEvent.error(screen.getByTestId('browser-tab-favicon'))
  expect(screen.queryByTestId('browser-tab-favicon')).toBeNull()
  rerender(
    <BrowserTabFavicon
      favicon="data:image/png;base64,GOOD"
      url="https://x.com/"
    />
  )

  expect(screen.getByTestId('browser-tab-favicon')).toHaveAttribute(
    'src',
    'data:image/png;base64,GOOD'
  )
})
