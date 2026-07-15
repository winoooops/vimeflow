import { test, expect, vi } from 'vitest'
import { render as rtlRender, screen, fireEvent } from '@testing-library/react'
import type { ReactElement } from 'react'
import { SettingsContext } from '../../settings/SettingsProvider'
import { DEFAULT_SETTINGS } from '../../settings/store/settingsDefaults'
import {
  BrowserAddressBar,
  type BrowserAddressBarProps,
} from './BrowserAddressBar'

const render = (
  ui: ReactElement,
  customKeybindings: Record<string, string> = {}
): ReturnType<typeof rtlRender> =>
  rtlRender(
    <SettingsContext.Provider
      value={{
        settings: { ...DEFAULT_SETTINGS, customKeybindings },
        saveError: null,
        update: vi.fn(),
      }}
    >
      {ui}
    </SettingsContext.Provider>
  )

const baseProps: BrowserAddressBarProps = {
  committedUrl: 'https://github.com/winoooops/vimeflow',
  draft: 'https://github.com/winoooops/vimeflow',
  isEditing: false,
  onBeginEdit: () => undefined,
  onDraftChange: () => undefined,
  onSubmit: () => undefined,
  onCancel: () => undefined,
}

test('display mode renders scheme/host/path segments and an https lock', () => {
  render(<BrowserAddressBar {...baseProps} />)

  expect(screen.getByText('https://')).toBeInTheDocument()
  expect(screen.getByText('github.com')).toBeInTheDocument()
  expect(screen.getByText('lock')).toBeInTheDocument()
})

test('a non-https URL shows lock_open', () => {
  render(
    <BrowserAddressBar
      {...baseProps}
      committedUrl="http://localhost:3000/"
      draft="http://localhost:3000/"
    />
  )

  expect(screen.getByText('lock_open')).toBeInTheDocument()
})

test('clicking the display pill begins editing', () => {
  const onBeginEdit = vi.fn()
  render(<BrowserAddressBar {...baseProps} onBeginEdit={onBeginEdit} />)

  fireEvent.click(screen.getByRole('button', { name: /address bar/ }))

  expect(onBeginEdit).toHaveBeenCalledOnce()
})

test('edit mode focuses the input and submits the draft', () => {
  const onSubmit = vi.fn()
  render(
    <BrowserAddressBar
      {...baseProps}
      isEditing
      draft="example.com"
      onSubmit={onSubmit}
    />
  )

  const input = screen.getByLabelText('browser address')
  expect(input).toHaveFocus()

  fireEvent.submit(input)

  expect(onSubmit).toHaveBeenCalledWith('example.com')
})

test('Escape and blur both cancel editing', () => {
  const onCancel = vi.fn()
  render(<BrowserAddressBar {...baseProps} isEditing onCancel={onCancel} />)

  const input = screen.getByLabelText('browser address')
  fireEvent.keyDown(input, { key: 'Escape' })
  fireEvent.blur(input)

  expect(onCancel).toHaveBeenCalledTimes(2)
})

test('a malformed committed URL renders raw without crashing', () => {
  render(
    <BrowserAddressBar
      {...baseProps}
      committedUrl="not a url"
      draft="not a url"
    />
  )

  expect(screen.getByText('not a url')).toBeInTheDocument()
})

test('the decorative lock icon is aria-hidden', () => {
  render(<BrowserAddressBar {...baseProps} />)

  expect(screen.getByText('lock')).toHaveAttribute('aria-hidden', 'true')
})

test('renders the resolved browser-location shortcut and ARIA binding', () => {
  render(<BrowserAddressBar {...baseProps} />, {
    'browser-location': 'Mod+Shift+KeyK',
  })

  expect(screen.getByText('Ctrl+Shift+K')).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: /Ctrl\+Shift\+K/ })
  ).toHaveAttribute('aria-keyshortcuts', 'Control+Shift+K')
})
