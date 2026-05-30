import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Mock } from 'vitest'
import type { BrowserPaneCreateResult } from '../types'
import type { Pane, Session } from '../../sessions/types'
import { emptyActivity } from '../../sessions/constants'
import { BrowserPane } from './BrowserPane'

const bridgeMocks = vi.hoisted(() => ({
  activateBrowserPaneTab: vi.fn().mockResolvedValue(undefined),
  closeBrowserPaneTab: vi.fn().mockResolvedValue(undefined),
  createBrowserPane: vi.fn(),
  focusBrowserPane: vi.fn().mockResolvedValue(undefined),
  getBrowserCdpInfo: vi.fn(),
  navigateBrowserPane: vi.fn().mockResolvedValue(undefined),
  newBrowserPaneTab: vi.fn().mockResolvedValue(undefined),
  onBrowserPaneFocus: vi.fn(() => (): void => undefined) as Mock<
    (callback: (event: unknown) => void) => () => void
  >,
  onBrowserPaneTabsChange: vi.fn(() => (): void => undefined) as Mock<
    (callback: (event: unknown) => void) => () => void
  >,
  onBrowserPaneUrlChange: vi.fn(() => (): void => undefined) as Mock<
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
  browserSessionId: 'pty-shell',
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

  test('applies bounds only after the native browser pane is created', async () => {
    render(<BrowserPane session={session} pane={browserPane} isActive />)

    await waitFor(() => {
      expect(bridgeMocks.createBrowserPane).toHaveBeenCalledOnce()
    })

    // Before the native pane resolves, bounds IPC is suppressed — main would
    // silently drop it (pane not yet registered).
    expect(bridgeMocks.setBrowserPaneBounds).not.toHaveBeenCalled()

    const callsBeforeCreate = bridgeMocks.setBrowserPaneBounds.mock.calls.length

    act(() => {
      resolveCreate({
        url: 'https://example.com/',
        title: 'Example',
        partition: 'persist:vimeflow-browser:proj-1:pty-shell',
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

    await waitFor(() => {
      expect(bridgeMocks.getBrowserCdpInfo).toHaveBeenCalledWith({
        sessionId: 'pty-shell',
        paneId: 'p1',
      })

      expect(
        bridgeMocks.setBrowserPaneBounds.mock.calls.length
      ).toBeGreaterThan(callsBeforeCreate)
    })

    expect(bridgeMocks.setBrowserPaneBounds).toHaveBeenLastCalledWith({
      sessionId: 'pty-shell',
      paneId: 'p1',
      bounds: { x: 10, y: 20, width: 640, height: 360 },
      shortcutContext: { activePaneId: 'p1', paneIds: ['p0', 'p1'] },
      visible: true,
    })
  })

  test('keeps chrome input focus when it activates an inactive browser pane', async () => {
    const user = userEvent.setup()
    const onRequestActive = vi.fn()
    const inactivePane = { ...browserPane, active: false }

    const inactiveSession = {
      ...session,
      panes: [shellPane, inactivePane],
    }

    const { rerender } = render(
      <BrowserPane
        session={inactiveSession}
        pane={inactivePane}
        isActive
        onRequestActive={onRequestActive}
      />
    )

    await user.click(screen.getByLabelText('browser address'))

    expect(onRequestActive).toHaveBeenCalledWith(session.id, browserPane.id)

    const activePane = { ...inactivePane, active: true }
    rerender(
      <BrowserPane
        session={{ ...inactiveSession, panes: [shellPane, activePane] }}
        pane={activePane}
        isActive
        onRequestActive={onRequestActive}
      />
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(bridgeMocks.focusBrowserPane).not.toHaveBeenCalled()
    expect(screen.getByLabelText('browser address')).toHaveFocus()
  })

  test('close button fires before chrome click propagation is stopped', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(
      <BrowserPane
        session={session}
        pane={browserPane}
        isActive
        onClose={onClose}
      />
    )

    await user.click(screen.getByRole('button', { name: 'close browser pane' }))

    expect(onClose).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledWith(session.id, browserPane.id)
  })

  test('preserves address drafts when pane metadata changes', async () => {
    const user = userEvent.setup()

    const { rerender } = render(
      <BrowserPane session={session} pane={browserPane} isActive />
    )

    act(() => {
      resolveCreate({
        url: 'https://example.com/',
        title: 'Example',
        partition: 'persist:vimeflow-browser:proj-1:pty-shell',
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

    await waitFor(() => {
      expect(bridgeMocks.getBrowserCdpInfo).toHaveBeenCalled()
    })

    const address = screen.getByLabelText('browser address')

    await user.clear(address)
    await user.type(address, 'github.com/login')

    rerender(
      <BrowserPane
        session={{
          ...session,
          panes: [shellPane, { ...browserPane, agentTitle: 'metadata change' }],
        }}
        pane={{ ...browserPane, agentTitle: 'metadata change' }}
        isActive
      />
    )

    expect(screen.getByLabelText('browser address')).toHaveValue(
      'github.com/login'
    )
    expect(bridgeMocks.createBrowserPane).toHaveBeenCalledOnce()
  })

  test('submits the typed draft even after the address input blurs', async () => {
    const user = userEvent.setup()
    render(<BrowserPane session={session} pane={browserPane} isActive />)

    act(() => {
      resolveCreate({
        url: 'https://example.com/',
        title: 'Example',
        partition: 'persist:vimeflow-browser:proj-1:pty-shell',
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

    await waitFor(() => {
      expect(bridgeMocks.getBrowserCdpInfo).toHaveBeenCalled()
    })

    const address = screen.getByLabelText('browser address')
    await user.clear(address)
    await user.type(address, 'github.com/login')

    // Keyboard Tab-to-Go: focus leaves the input (it blurs and reverts its
    // DISPLAY to the committed URL), then the Go button is activated by
    // keyboard. The submit must still navigate the typed draft, not the
    // committed URL the display reverted to.
    await user.tab()
    await user.keyboard('{Enter}')

    expect(bridgeMocks.navigateBrowserPane).toHaveBeenCalledWith({
      sessionId: 'pty-shell',
      paneId: 'p1',
      url: 'https://github.com/login',
    })
  })

  test('idle Go submits the current page URL after a background navigation', async () => {
    const user = userEvent.setup()
    render(<BrowserPane session={session} pane={browserPane} isActive />)

    act(() => {
      resolveCreate({
        url: 'https://example.com/',
        title: 'Example',
        partition: 'persist:vimeflow-browser:proj-1:pty-shell',
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

    await waitFor(() => {
      expect(bridgeMocks.getBrowserCdpInfo).toHaveBeenCalled()
    })

    // The page navigates while the address bar is NOT focused. The bar must
    // follow the live URL so an idle Go submits what is displayed, not a
    // stale hidden draft.
    const urlCallback = bridgeMocks.onBrowserPaneUrlChange.mock
      .calls[0][0] as (event: {
      sessionId: string
      paneId: string
      tabId: string
      url: string
      title: string | null
      tabs: {
        id: string
        url: string
        title: string | null
        active: boolean
      }[]
    }) => void

    act(() => {
      urlCallback({
        sessionId: 'pty-shell',
        paneId: 'p1',
        tabId: 'tab-0',
        url: 'https://youtube.com/watch',
        title: 'Watch',
        tabs: [
          {
            id: 'tab-0',
            url: 'https://youtube.com/watch',
            title: 'Watch',
            active: true,
          },
        ],
      })
    })

    expect(screen.getByLabelText('browser address')).toHaveValue(
      'https://youtube.com/watch'
    )

    // Click Go without focusing the input first.
    await user.click(screen.getByRole('button', { name: 'Go' }))

    expect(bridgeMocks.navigateBrowserPane).toHaveBeenCalledWith({
      sessionId: 'pty-shell',
      paneId: 'p1',
      url: 'https://youtube.com/watch',
    })
  })

  test('address bar follows post-submit redirects', async () => {
    const user = userEvent.setup()
    render(<BrowserPane session={session} pane={browserPane} isActive />)

    act(() => {
      resolveCreate({
        url: 'https://example.com/',
        title: 'Example',
        partition: 'persist:vimeflow-browser:proj-1:pty-shell',
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

    await waitFor(() => {
      expect(bridgeMocks.getBrowserCdpInfo).toHaveBeenCalled()
    })

    const address = screen.getByLabelText('browser address')
    await user.clear(address)
    await user.type(address, 'github.com')
    // Submit by pressing Enter while the input still has focus.
    await user.keyboard('{Enter}')

    expect(bridgeMocks.navigateBrowserPane).toHaveBeenCalledWith({
      sessionId: 'pty-shell',
      paneId: 'p1',
      url: 'https://github.com',
    })

    // A redirect resolves to a different URL after submit. Edit mode was
    // cleared on submit, so the bar must follow the redirect even though the
    // input never blurred.
    const urlCallback = bridgeMocks.onBrowserPaneUrlChange.mock
      .calls[0][0] as (event: {
      sessionId: string
      paneId: string
      tabId: string
      url: string
      title: string | null
      tabs: {
        id: string
        url: string
        title: string | null
        active: boolean
      }[]
    }) => void

    act(() => {
      urlCallback({
        sessionId: 'pty-shell',
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

    expect(screen.getByLabelText('browser address')).toHaveValue(
      'https://github.com/dashboard'
    )
  })

  test('reverts an abandoned draft to the live URL when editing is cancelled', async () => {
    const user = userEvent.setup()
    render(<BrowserPane session={session} pane={browserPane} isActive />)

    act(() => {
      resolveCreate({
        url: 'https://example.com/',
        title: 'Example',
        partition: 'persist:vimeflow-browser:proj-1:pty-shell',
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

    await waitFor(() => {
      expect(bridgeMocks.getBrowserCdpInfo).toHaveBeenCalled()
    })

    const address = screen.getByLabelText('browser address')
    await user.clear(address)
    await user.type(address, 'abc')

    // A background navigation lands while the bar is focused — the idle mirror
    // is paused, so the draft does NOT update.
    const urlCallback = bridgeMocks.onBrowserPaneUrlChange.mock
      .calls[0][0] as (event: {
      sessionId: string
      paneId: string
      tabId: string
      url: string
      title: string | null
      tabs: {
        id: string
        url: string
        title: string | null
        active: boolean
      }[]
    }) => void

    act(() => {
      urlCallback({
        sessionId: 'pty-shell',
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

    // Cancel: blur to something other than the submit button. The abandoned
    // 'abc' draft must revert to the live committed URL, not linger.
    fireEvent.blur(address, { relatedTarget: document.body })

    expect(screen.getByLabelText('browser address')).toHaveValue(
      'https://example.com/page'
    )
  })

  test('clicking a tab calls activateBrowserPaneTab', async () => {
    const user = userEvent.setup()

    render(<BrowserPane session={session} pane={browserPane} isActive />)

    act(() => {
      resolveCreate({
        url: 'https://example.com/',
        title: 'Example',
        partition: 'persist:vimeflow-browser:proj-1:pty-shell',
        tabs: [
          {
            id: 'tab-0',
            url: 'https://example.com/',
            title: 'Example',
            active: true,
          },
          {
            id: 'tab-1',
            url: 'https://other.com/',
            title: 'Other',
            active: false,
          },
        ],
      })
    })

    await waitFor(() => {
      expect(
        screen.getByRole('tab', { name: 'browser tab Other' })
      ).toBeInTheDocument()
    })

    await user.click(screen.getByRole('tab', { name: 'browser tab Other' }))

    expect(bridgeMocks.activateBrowserPaneTab).toHaveBeenCalledWith({
      sessionId: 'pty-shell',
      paneId: 'p1',
      tabId: 'tab-1',
    })
  })

  test('clicking the new-tab button calls newBrowserPaneTab', async () => {
    const user = userEvent.setup()

    render(<BrowserPane session={session} pane={browserPane} isActive />)

    act(() => {
      resolveCreate({
        url: 'https://example.com/',
        title: 'Example',
        partition: 'persist:vimeflow-browser:proj-1:pty-shell',
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

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'new browser tab' })
      ).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'new browser tab' }))

    expect(bridgeMocks.newBrowserPaneTab).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'pty-shell',
        paneId: 'p1',
      })
    )
  })

  test('clicking a tab close button calls closeBrowserPaneTab', async () => {
    const user = userEvent.setup()

    render(<BrowserPane session={session} pane={browserPane} isActive />)

    act(() => {
      resolveCreate({
        url: 'https://example.com/',
        title: 'Example',
        partition: 'persist:vimeflow-browser:proj-1:pty-shell',
        tabs: [
          {
            id: 'tab-0',
            url: 'https://example.com/',
            title: 'Example',
            active: true,
          },
          {
            id: 'tab-1',
            url: 'https://other.com/',
            title: 'Other',
            active: false,
          },
        ],
      })
    })

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'close browser tab Other' })
      ).toBeInTheDocument()
    })

    await user.click(
      screen.getByRole('button', { name: 'close browser tab Other' })
    )

    expect(bridgeMocks.closeBrowserPaneTab).toHaveBeenCalledWith({
      sessionId: 'pty-shell',
      paneId: 'p1',
      tabId: 'tab-1',
    })
  })

  test('firing onBrowserPaneTabsChange updates the tab strip', async () => {
    render(<BrowserPane session={session} pane={browserPane} isActive />)

    act(() => {
      resolveCreate({
        url: 'https://example.com/',
        title: 'Example',
        partition: 'persist:vimeflow-browser:proj-1:pty-shell',
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

    await waitFor(() => {
      expect(bridgeMocks.onBrowserPaneTabsChange).toHaveBeenCalled()
    })

    const callback = bridgeMocks.onBrowserPaneTabsChange.mock
      .calls[0][0] as (event: {
      sessionId: string
      paneId: string
      tabs: {
        id: string
        url: string
        title: string | null
        active: boolean
      }[]
    }) => void

    act(() => {
      callback({
        sessionId: 'pty-shell',
        paneId: 'p1',
        tabs: [
          {
            id: 'tab-0',
            url: 'https://example.com/',
            title: 'Example',
            active: false,
          },
          {
            id: 'tab-1',
            url: 'https://new.com/',
            title: 'New',
            active: true,
          },
        ],
      })
    })

    expect(
      screen.getByRole('tab', { name: 'browser tab New' })
    ).toBeInTheDocument()
  })

  test('survives an empty tabs-changed event during teardown', async () => {
    render(<BrowserPane session={session} pane={browserPane} isActive />)

    act(() => {
      resolveCreate({
        url: 'https://example.com/',
        title: 'Example',
        partition: 'persist:vimeflow-browser:proj-1:pty-shell',
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

    await waitFor(() => {
      expect(bridgeMocks.onBrowserPaneTabsChange).toHaveBeenCalled()
    })

    const callback = bridgeMocks.onBrowserPaneTabsChange.mock
      .calls[0][0] as (event: {
      sessionId: string
      paneId: string
      tabs: {
        id: string
        url: string
        title: string | null
        active: boolean
      }[]
    }) => void

    expect(() => {
      act(() => {
        callback({ sessionId: 'pty-shell', paneId: 'p1', tabs: [] })
      })
    }).not.toThrow()

    expect(screen.getByLabelText('browser address')).toBeInTheDocument()
  })

  test('keeps a typed address draft when native url events arrive', async () => {
    const user = userEvent.setup()
    render(<BrowserPane session={session} pane={browserPane} isActive />)

    act(() => {
      resolveCreate({
        url: 'https://example.com/',
        title: 'Example',
        partition: 'persist:vimeflow-browser:proj-1:pty-shell',
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

    await waitFor(() => {
      expect(bridgeMocks.getBrowserCdpInfo).toHaveBeenCalled()
    })

    const address = screen.getByLabelText('browser address')
    await user.clear(address)
    await user.type(address, 'github.com/login')

    // A SPA title change forwards a url-changed event for the same page URL —
    // it must NOT clobber the user's in-progress draft.
    const urlCallback = bridgeMocks.onBrowserPaneUrlChange.mock
      .calls[0][0] as (event: {
      sessionId: string
      paneId: string
      tabId: string
      url: string
      title: string | null
      tabs: {
        id: string
        url: string
        title: string | null
        active: boolean
      }[]
    }) => void

    act(() => {
      urlCallback({
        sessionId: 'pty-shell',
        paneId: 'p1',
        tabId: 'tab-0',
        url: 'https://example.com/',
        title: 'Example - updated',
        tabs: [
          {
            id: 'tab-0',
            url: 'https://example.com/',
            title: 'Example - updated',
            active: true,
          },
        ],
      })
    })

    expect(screen.getByLabelText('browser address')).toHaveValue(
      'github.com/login'
    )
  })
})
