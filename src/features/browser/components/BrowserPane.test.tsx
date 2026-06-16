import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Mock } from 'vitest'
import type { ReactElement } from 'react'
import type { BrowserPaneCreateResult } from '../types'
import type { Pane, Session } from '../../sessions/types'
import { emptyActivity } from '../../sessions/constants'
import { BrowserPane, type BrowserPaneProps } from './BrowserPane'
import { OverlayStackProvider } from '../../workspace/overlays/OverlayStackProvider'
import { useOverlayRegistration } from '../../workspace/overlays/useOverlayRegistration'

const bridgeMocks = vi.hoisted(() => ({
  activateBrowserPaneTab: vi.fn().mockResolvedValue(undefined),
  closeBrowserPaneTab: vi.fn().mockResolvedValue(undefined),
  createBrowserPane: vi.fn(),
  focusBrowserPane: vi.fn().mockResolvedValue(undefined),
  getBrowserCdpInfo: vi.fn(),
  navigateBrowserPane: vi.fn().mockResolvedValue(undefined),
  newBrowserPaneTab: vi.fn().mockResolvedValue(undefined),
  openExternalBrowserPane: vi.fn().mockResolvedValue(undefined),
  navActionBrowserPane: vi.fn().mockResolvedValue(undefined),
  onBrowserPaneFocus: vi.fn(() => (): void => undefined) as Mock<
    (callback: (event: unknown) => void) => () => void
  >,
  onBrowserPaneFocusAddress: vi.fn(() => (): void => undefined) as Mock<
    (callback: (event: unknown) => void) => () => void
  >,
  onBrowserPaneTabsChange: vi.fn(() => (): void => undefined) as Mock<
    (callback: (event: unknown) => void) => () => void
  >,
  onBrowserPaneUrlChange: vi.fn(() => (): void => undefined) as Mock<
    (callback: (event: unknown) => void) => () => void
  >,
  onBrowserPaneNavStateChange: vi.fn(() => (): void => undefined) as Mock<
    (callback: (event: unknown) => void) => () => void
  >,
  setBrowserPaneBounds: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../browserBridge', () => bridgeMocks)

const shellPane: Pane = {
  kind: 'shell',
  id: 'p0',
  ptyId: 'pty-shell',
  cwd: '/project',
  agentType: 'generic',
  status: 'running',
  active: false,
}

const browserPane: Pane = {
  kind: 'browser',
  id: 'p1',
  ptyId: 'browser-1',
  cwd: '/project',
  agentType: 'generic',
  status: 'running',
  active: true,
  browserUrl: 'https://example.com/',
}

const session: Session = {
  id: 'session-1',
  projectId: 'proj-1',
  name: 'session 1',
  status: 'running',
  workingDirectory: '/project',
  agentType: 'generic',
  layout: 'vsplit',
  activityPanelCollapsed: false,
  panes: [shellPane, browserPane],
  createdAt: '2026-05-28T00:00:00.000Z',
  lastActivityAt: '2026-05-28T00:00:00.000Z',
  activity: { ...emptyActivity },
}

const rect = {
  x: 10,
  y: 20,
  left: 10,
  top: 20,
  right: 650,
  bottom: 380,
  width: 640,
  height: 360,
  toJSON: (): Record<string, number> => ({}),
} as DOMRect

const singleTab: BrowserPaneCreateResult = {
  url: 'https://example.com/',
  title: 'Example',
  partition: 'persist:vimeflow-browser:proj-1:pty-shell',
  tabs: [
    {
      id: 'tab-0',
      url: 'https://example.com/',
      title: 'Example',
      active: true,
      favicon: null,
    },
  ],
  navState: { canGoBack: false, canGoForward: false, isLoading: false },
}

const inactive = false

interface OverlayProbeProps {
  isOpen: boolean
}

const OverlayProbe = ({ isOpen }: OverlayProbeProps): ReactElement | null => {
  useOverlayRegistration({
    id: 'test-overlay',
    plane: 'palette',
    isOpen,
    nativeOcclusion: 'global',
  })

  return null
}

interface BrowserPaneHarnessProps extends BrowserPaneProps {
  overlayOpen?: boolean
}

const BrowserPaneHarness = ({
  overlayOpen = false,
  ...props
}: BrowserPaneHarnessProps): ReactElement => (
  <OverlayStackProvider>
    <OverlayProbe isOpen={overlayOpen} />
    <BrowserPane {...props} />
  </OverlayStackProvider>
)

interface UrlEvent {
  sessionId: string
  paneId: string
  tabId: string
  url: string
  title: string | null
  tabs: { id: string; url: string; title: string | null; active: boolean }[]
}

const urlCallback = (): ((event: UrlEvent) => void) =>
  bridgeMocks.onBrowserPaneUrlChange.mock.calls[0][0] as (
    event: UrlEvent
  ) => void

interface NavStateEvent {
  sessionId: string
  paneId: string
  tabId: string
  canGoBack: boolean
  canGoForward: boolean
  isLoading: boolean
}

const navStateCallback = (): ((event: NavStateEvent) => void) =>
  bridgeMocks.onBrowserPaneNavStateChange.mock.calls[0][0] as (
    event: NavStateEvent
  ) => void

interface TabsEvent {
  sessionId: string
  paneId: string
  tabs: {
    id: string
    url: string
    title: string | null
    active: boolean
    favicon: string | null
  }[]
}

const tabsCallback = (): ((event: TabsEvent) => void) =>
  bridgeMocks.onBrowserPaneTabsChange.mock.calls[0][0] as (
    event: TabsEvent
  ) => void

describe('BrowserPane', () => {
  let resolveCreate: (result: BrowserPaneCreateResult) => void
  let rectSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue(rect)

    bridgeMocks.createBrowserPane.mockImplementation(
      () =>
        new Promise<BrowserPaneCreateResult>((resolve) => {
          resolveCreate = resolve
        })
    )

    bridgeMocks.getBrowserCdpInfo.mockResolvedValue({
      url: 'http://127.0.0.1:9223',
      token: 'token',
      origin: 'vimeflow://agent-plugin/local',
      targetId: 'pty-shell:p1',
    })
  })

  afterEach(() => {
    rectSpy.mockRestore()
  })

  const settle = async (): Promise<void> => {
    act(() => resolveCreate(singleTab))
    await waitFor(() => {
      expect(bridgeMocks.getBrowserCdpInfo).toHaveBeenCalled()
    })
  }

  const beginEdit = async (
    user: ReturnType<typeof userEvent.setup>
  ): Promise<HTMLElement> => {
    await user.click(screen.getByRole('button', { name: /address bar/ }))

    return screen.getByLabelText('browser address')
  }

  test('applies bounds only after the native browser pane is created', async () => {
    render(<BrowserPaneHarness session={session} pane={browserPane} isActive />)

    await waitFor(() => {
      expect(bridgeMocks.createBrowserPane).toHaveBeenCalledOnce()
    })

    expect(bridgeMocks.setBrowserPaneBounds).not.toHaveBeenCalled()
    await settle()

    expect(bridgeMocks.setBrowserPaneBounds).toHaveBeenLastCalledWith({
      sessionId: 'session-1',
      paneId: 'p1',
      bounds: { x: 10, y: 20, width: 640, height: 360 },
      shortcutContext: { activePaneId: 'p1', paneIds: ['p0', 'p1'] },
      visible: true,
    })
  })

  test('marks the native browser pane invisible while occluded, then restores it', async () => {
    const { rerender } = render(
      <BrowserPaneHarness
        session={session}
        pane={browserPane}
        isActive
        overlayOpen
      />
    )

    await waitFor(() => {
      expect(bridgeMocks.createBrowserPane).toHaveBeenCalledOnce()
    })
    await settle()

    expect(bridgeMocks.setBrowserPaneBounds).toHaveBeenLastCalledWith({
      sessionId: 'session-1',
      paneId: 'p1',
      bounds: { x: 10, y: 20, width: 640, height: 360 },
      shortcutContext: { activePaneId: 'p1', paneIds: ['p0', 'p1'] },
      visible: false,
    })

    rerender(
      <BrowserPaneHarness session={session} pane={browserPane} isActive />
    )

    await waitFor(() => {
      expect(bridgeMocks.setBrowserPaneBounds).toHaveBeenLastCalledWith({
        sessionId: 'session-1',
        paneId: 'p1',
        bounds: { x: 10, y: 20, width: 640, height: 360 },
        shortcutContext: { activePaneId: 'p1', paneIds: ['p0', 'p1'] },
        visible: true,
      })
    })
  })

  test('keeps the native browser pane invisible when the session panel is inactive', async () => {
    render(
      <BrowserPaneHarness
        session={session}
        pane={browserPane}
        isActive={inactive}
      />
    )

    await waitFor(() => {
      expect(bridgeMocks.createBrowserPane).toHaveBeenCalledOnce()
    })
    await settle()

    expect(bridgeMocks.setBrowserPaneBounds).toHaveBeenLastCalledWith({
      sessionId: 'session-1',
      paneId: 'p1',
      bounds: { x: 10, y: 20, width: 640, height: 360 },
      shortcutContext: { activePaneId: 'p1', paneIds: ['p0', 'p1'] },
      visible: false,
    })
  })

  test('the focus border uses the cyan WEB accent only when the pane is active', () => {
    const { rerender } = render(
      <BrowserPaneHarness session={session} pane={browserPane} isActive />
    )
    // accent is now a CSS var reference; jsdom preserves var() in style strings.
    expect(screen.getByTestId('browser-pane').style.border).toContain(
      'var(--color-agent-browser-accent)'
    )

    rerender(
      <BrowserPaneHarness
        session={session}
        pane={{ ...browserPane, active: false }}
        isActive
      />
    )

    expect(screen.getByTestId('browser-pane').style.border).toContain(
      'color-mix(in srgb, var(--color-outline-variant) 22%, transparent)'
    )
  })

  test('the address bar is a display button until it is edited', async () => {
    const user = userEvent.setup()
    render(<BrowserPaneHarness session={session} pane={browserPane} isActive />)
    await settle()

    expect(screen.queryByLabelText('browser address')).toBeNull()
    const input = await beginEdit(user)
    expect(input).toHaveFocus()
  })

  test('submitting the address normalizes and navigates', async () => {
    const user = userEvent.setup()
    render(<BrowserPaneHarness session={session} pane={browserPane} isActive />)
    await settle()

    const input = await beginEdit(user)
    await user.clear(input)
    await user.type(input, 'github.com/login')
    await user.keyboard('{Enter}')

    expect(bridgeMocks.navigateBrowserPane).toHaveBeenCalledWith({
      sessionId: 'session-1',
      paneId: 'p1',
      url: 'https://github.com/login',
    })
  })

  test('a nav-state event lights up back and toggles reload to stop', async () => {
    render(<BrowserPaneHarness session={session} pane={browserPane} isActive />)
    await settle()

    act(() =>
      navStateCallback()({
        sessionId: 'session-1',
        paneId: 'p1',
        tabId: 'tab-0',
        canGoBack: true,
        canGoForward: false,
        isLoading: true,
      })
    )

    expect(screen.getByRole('button', { name: 'back' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'stop' })).toBeInTheDocument()
  })

  test('a nav-state event for a different pane is ignored', async () => {
    render(<BrowserPaneHarness session={session} pane={browserPane} isActive />)
    await settle()

    act(() =>
      navStateCallback()({
        sessionId: 'other',
        paneId: 'other',
        tabId: 'tab-0',
        canGoBack: true,
        canGoForward: true,
        isLoading: false,
      })
    )

    expect(screen.getByRole('button', { name: 'back' })).toBeDisabled()
  })

  test('a tabs-changed event with a favicon updates the tab icon', async () => {
    render(<BrowserPaneHarness session={session} pane={browserPane} isActive />)
    await settle()

    act(() =>
      tabsCallback()({
        sessionId: 'session-1',
        paneId: 'p1',
        tabs: [
          {
            id: 'tab-0',
            url: 'https://x.com/',
            title: 'X',
            active: true,
            favicon: 'data:image/png;base64,AAAA',
          },
        ],
      })
    )

    expect(screen.getByTestId('browser-tab-favicon')).toHaveAttribute(
      'src',
      'data:image/png;base64,AAAA'
    )
  })

  test('the load bar shows when nav-state reports loading', async () => {
    render(<BrowserPaneHarness session={session} pane={browserPane} isActive />)
    await settle()

    act(() =>
      navStateCallback()({
        sessionId: 'session-1',
        paneId: 'p1',
        tabId: 'tab-0',
        canGoBack: false,
        canGoForward: false,
        isLoading: true,
      })
    )

    expect(screen.getByTestId('browser-load-bar')).toBeInTheDocument()
  })

  test('back and reload dispatch nav-action through the bridge', async () => {
    const user = userEvent.setup()
    render(<BrowserPaneHarness session={session} pane={browserPane} isActive />)
    await settle()

    act(() =>
      navStateCallback()({
        sessionId: 'session-1',
        paneId: 'p1',
        tabId: 'tab-0',
        canGoBack: true,
        canGoForward: false,
        isLoading: false,
      })
    )

    await user.click(screen.getByRole('button', { name: 'back' }))
    await user.click(screen.getByRole('button', { name: 'reload' }))

    expect(bridgeMocks.navActionBrowserPane).toHaveBeenCalledWith({
      sessionId: 'session-1',
      paneId: 'p1',
      action: 'back',
    })

    expect(bridgeMocks.navActionBrowserPane).toHaveBeenCalledWith({
      sessionId: 'session-1',
      paneId: 'p1',
      action: 'reload',
    })
  })

  test('the create-result navState seeds the toolbar', async () => {
    render(<BrowserPaneHarness session={session} pane={browserPane} isActive />)

    act(() =>
      resolveCreate({
        ...singleTab,
        navState: { canGoBack: true, canGoForward: false, isLoading: false },
      })
    )

    await waitFor(() => {
      expect(bridgeMocks.getBrowserCdpInfo).toHaveBeenCalled()
    })

    expect(screen.getByRole('button', { name: 'back' })).not.toBeDisabled()
  })

  test('a live nav-state event before create resolves is not clobbered by the seed', async () => {
    render(<BrowserPaneHarness session={session} pane={browserPane} isActive />)

    // Live event arrives before createBrowserPane resolves.
    act(() =>
      navStateCallback()({
        sessionId: 'session-1',
        paneId: 'p1',
        tabId: 'tab-0',
        canGoBack: false,
        canGoForward: false,
        isLoading: true,
      })
    )

    // Create resolves with a stale snapshot (isLoading: false).
    await settle()

    // The live event wins: the guard keeps the toolbar on stop.
    expect(screen.getByRole('button', { name: 'stop' })).toBeInTheDocument()
  })

  test('the draft survives native url events while editing', async () => {
    const user = userEvent.setup()
    render(<BrowserPaneHarness session={session} pane={browserPane} isActive />)
    await settle()

    const input = await beginEdit(user)
    await user.clear(input)
    await user.type(input, 'github.com/login')

    act(() => {
      urlCallback()({
        sessionId: 'session-1',
        paneId: 'p1',
        tabId: 'tab-0',
        url: 'https://example.com/',
        title: 'Example - updated',
        tabs: [
          {
            id: 'tab-0',
            url: 'https://example.com/',
            title: 'Example',
            active: true,
          },
        ],
      })
    })

    expect(screen.getByLabelText('browser address')).toHaveValue(
      'github.com/login'
    )
  })

  test('blur cancels editing and reverts the display to the committed URL', async () => {
    const user = userEvent.setup()
    render(<BrowserPaneHarness session={session} pane={browserPane} isActive />)
    await settle()

    const input = await beginEdit(user)
    await user.clear(input)
    await user.type(input, 'abandoned')

    act(() => {
      urlCallback()({
        sessionId: 'session-1',
        paneId: 'p1',
        tabId: 'tab-0',
        url: 'https://example.com/page',
        title: 'Page',
        tabs: [
          {
            id: 'tab-0',
            url: 'https://example.com/page',
            title: 'Page',
            active: true,
          },
        ],
      })
    })

    fireEvent.blur(input)

    expect(screen.queryByLabelText('browser address')).toBeNull()
    expect(
      screen.getByRole('button', { name: /example\.com\/page/ })
    ).toBeInTheDocument()
  })

  test('the display follows redirects after a submit (not editing)', async () => {
    const user = userEvent.setup()
    render(<BrowserPaneHarness session={session} pane={browserPane} isActive />)
    await settle()

    const input = await beginEdit(user)
    await user.clear(input)
    await user.type(input, 'github.com')
    await user.keyboard('{Enter}')

    act(() => {
      urlCallback()({
        sessionId: 'session-1',
        paneId: 'p1',
        tabId: 'tab-0',
        url: 'https://github.com/dashboard',
        title: 'Dashboard',
        tabs: [
          {
            id: 'tab-0',
            url: 'https://github.com/dashboard',
            title: 'Dashboard',
            active: true,
          },
        ],
      })
    })

    expect(
      screen.getByRole('button', { name: /github\.com\/dashboard/ })
    ).toBeInTheDocument()
  })

  test('Cmd/Ctrl+L from the chrome enters address edit', async () => {
    render(<BrowserPaneHarness session={session} pane={browserPane} isActive />)
    await waitFor(() => {
      expect(bridgeMocks.createBrowserPane).toHaveBeenCalledOnce()
    })

    fireEvent.keyDown(screen.getByTestId('browser-pane'), {
      code: 'KeyL',
      ctrlKey: true,
    })

    expect(screen.getByLabelText('browser address')).toBeInTheDocument()
  })

  test('a focus-address event enters edit only for the matching pane', async () => {
    render(<BrowserPaneHarness session={session} pane={browserPane} isActive />)
    await waitFor(() => {
      expect(bridgeMocks.onBrowserPaneFocusAddress).toHaveBeenCalled()
    })

    const cb = bridgeMocks.onBrowserPaneFocusAddress.mock
      .calls[0][0] as (event: { sessionId: string; paneId: string }) => void

    act(() => cb({ sessionId: 'session-1', paneId: 'WRONG' }))
    expect(screen.queryByLabelText('browser address')).toBeNull()

    act(() => cb({ sessionId: 'WRONG', paneId: 'p1' }))
    expect(screen.queryByLabelText('browser address')).toBeNull()

    act(() => cb({ sessionId: 'session-1', paneId: 'p1' }))
    expect(screen.getByLabelText('browser address')).toBeInTheDocument()
  })

  test('open-external calls the bridge with the derived pane ref', async () => {
    const user = userEvent.setup()
    render(<BrowserPaneHarness session={session} pane={browserPane} isActive />)
    await settle()

    await user.click(
      screen.getByRole('button', { name: 'open in system browser' })
    )

    expect(bridgeMocks.openExternalBrowserPane).toHaveBeenCalledWith({
      sessionId: 'session-1',
      paneId: 'p1',
    })
  })

  test('close-pane fires onClose with the session pane ref', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <BrowserPaneHarness
        session={session}
        pane={browserPane}
        isActive
        onClose={onClose}
      />
    )

    await user.click(screen.getByRole('button', { name: 'close browser pane' }))

    expect(onClose).toHaveBeenCalledWith(session.id, browserPane.id)
  })

  test('tab activate / new / close call the bridge with the derived pane ref', async () => {
    const user = userEvent.setup()
    render(<BrowserPaneHarness session={session} pane={browserPane} isActive />)

    act(() =>
      resolveCreate({
        ...singleTab,
        tabs: [
          {
            id: 'tab-0',
            url: 'https://example.com/',
            title: 'Example',
            active: true,
            favicon: null,
          },
          {
            id: 'tab-1',
            url: 'https://other.com/',
            title: 'Other',
            active: false,
            favicon: null,
          },
        ],
      })
    )

    await waitFor(() => {
      expect(
        screen.getByRole('tab', { name: 'browser tab Other' })
      ).toBeInTheDocument()
    })

    await user.click(screen.getByRole('tab', { name: 'browser tab Other' }))
    expect(bridgeMocks.activateBrowserPaneTab).toHaveBeenCalledWith({
      sessionId: 'session-1',
      paneId: 'p1',
      tabId: 'tab-1',
    })

    await user.click(screen.getByRole('button', { name: 'new browser tab' }))
    expect(bridgeMocks.newBrowserPaneTab).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-1', paneId: 'p1' })
    )

    await user.click(
      screen.getByRole('button', { name: 'close browser tab Other' })
    )

    expect(bridgeMocks.closeBrowserPaneTab).toHaveBeenCalledWith({
      sessionId: 'session-1',
      paneId: 'p1',
      tabId: 'tab-1',
    })
  })

  test('a tabs-changed event updates the tab strip', async () => {
    render(<BrowserPaneHarness session={session} pane={browserPane} isActive />)
    await settle()

    const callback = bridgeMocks.onBrowserPaneTabsChange.mock
      .calls[0][0] as (event: {
      sessionId: string
      paneId: string
      tabs: { id: string; url: string; title: string | null; active: boolean }[]
    }) => void

    act(() =>
      callback({
        sessionId: 'session-1',
        paneId: 'p1',
        tabs: [
          {
            id: 'tab-0',
            url: 'https://example.com/',
            title: 'Example',
            active: false,
          },
          { id: 'tab-1', url: 'https://new.com/', title: 'New', active: true },
        ],
      })
    )

    expect(
      screen.getByRole('tab', { name: 'browser tab New' })
    ).toBeInTheDocument()
  })

  test('an empty tabs-changed event during teardown does not crash', async () => {
    render(<BrowserPaneHarness session={session} pane={browserPane} isActive />)
    await settle()

    const callback = bridgeMocks.onBrowserPaneTabsChange.mock
      .calls[0][0] as (event: {
      sessionId: string
      paneId: string
      tabs: unknown[]
    }) => void

    expect(() => {
      act(() => callback({ sessionId: 'session-1', paneId: 'p1', tabs: [] }))
    }).not.toThrow()

    expect(screen.getByTestId('browser-pane')).toBeInTheDocument()
  })
})
