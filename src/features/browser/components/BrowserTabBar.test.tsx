import { test, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BrowserTabBar } from './BrowserTabBar'
import type { BrowserPaneTab } from '../types'

const tabs: BrowserPaneTab[] = [
  {
    id: 'tab-0',
    url: 'https://github.com/o/r/pull/1',
    title: 'PR',
    active: true,
    favicon: null,
  },
  { id: 'tab-1', url: 'https://example.com/', title: null, active: false, favicon: null },
]

const noop = (): void => undefined

test('renders the WEB identity chip', () => {
  render(
    <BrowserTabBar
      tabs={tabs}
      onActivate={noop}
      onClose={noop}
      onNewTab={noop}
    />
  )

  expect(screen.getByText('WEB')).toBeInTheDocument()
})

test('a PR-URL tab uses the merge favicon glyph', () => {
  render(
    <BrowserTabBar
      tabs={tabs}
      onActivate={noop}
      onClose={noop}
      onNewTab={noop}
    />
  )

  expect(screen.getByText('merge')).toBeInTheDocument()
})

test('activating and closing tabs fire callbacks with the tab id', () => {
  const onActivate = vi.fn()
  const onClose = vi.fn()
  render(
    <BrowserTabBar
      tabs={tabs}
      onActivate={onActivate}
      onClose={onClose}
      onNewTab={noop}
    />
  )

  fireEvent.click(screen.getByRole('tab', { name: 'browser tab PR' }))
  expect(onActivate).toHaveBeenCalledWith('tab-0')

  fireEvent.click(screen.getByRole('button', { name: 'close browser tab PR' }))
  expect(onClose).toHaveBeenCalledWith('tab-0')
})

test('the close-x is hidden when only one tab remains', () => {
  render(
    <BrowserTabBar
      tabs={[tabs[0]]}
      onActivate={noop}
      onClose={noop}
      onNewTab={noop}
    />
  )

  expect(screen.queryByRole('button', { name: /close browser tab/ })).toBeNull()
})

test('close-pane only renders when onClosePane is provided', () => {
  const onClosePane = vi.fn()

  const { rerender } = render(
    <BrowserTabBar
      tabs={tabs}
      onActivate={noop}
      onClose={noop}
      onNewTab={noop}
    />
  )

  expect(
    screen.queryByRole('button', { name: 'close browser pane' })
  ).toBeNull()

  rerender(
    <BrowserTabBar
      tabs={tabs}
      onActivate={noop}
      onClose={noop}
      onNewTab={noop}
      onClosePane={onClosePane}
    />
  )

  fireEvent.click(screen.getByRole('button', { name: 'close browser pane' }))
  expect(onClosePane).toHaveBeenCalledOnce()
})

test('new-tab fires onNewTab', () => {
  const onNewTab = vi.fn()
  render(
    <BrowserTabBar
      tabs={tabs}
      onActivate={noop}
      onClose={noop}
      onNewTab={onNewTab}
    />
  )

  fireEvent.click(screen.getByRole('button', { name: 'new browser tab' }))
  expect(onNewTab).toHaveBeenCalledOnce()
})

test('the close-x is keyboard-reachable (focus-within / focus-visible)', () => {
  render(
    <BrowserTabBar
      tabs={tabs}
      onActivate={noop}
      onClose={noop}
      onNewTab={noop}
    />
  )

  const closeBtn = screen.getByRole('button', { name: 'close browser tab PR' })
  expect(closeBtn.className).toMatch(/group-focus-within:opacity-80/)
  expect(closeBtn.className).toMatch(/focus-visible:opacity-100/)
})
