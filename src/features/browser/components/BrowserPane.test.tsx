import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { BrowserPaneCreateResult } from '../types'
import type { Pane, Session } from '../../sessions/types'
import { emptyActivity } from '../../sessions/constants'
import { BrowserPane } from './BrowserPane'

const bridgeMocks = vi.hoisted(() => ({
  createBrowserPane: vi.fn(),
  focusBrowserPane: vi.fn().mockResolvedValue(undefined),
  getBrowserCdpInfo: vi.fn(),
  navigateBrowserPane: vi.fn().mockResolvedValue(undefined),
  onBrowserPaneFocus: vi.fn(() => (): void => undefined),
  onBrowserPaneUrlChange: vi.fn(() => (): void => undefined),
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

  test('retries unchanged bounds after the native browser pane is created', async () => {
    render(<BrowserPane session={session} pane={browserPane} isActive />)

    await waitFor(() => {
      expect(bridgeMocks.createBrowserPane).toHaveBeenCalledOnce()
      expect(bridgeMocks.setBrowserPaneBounds).toHaveBeenCalled()
    })

    const callsBeforeCreate = bridgeMocks.setBrowserPaneBounds.mock.calls.length

    act(() => {
      resolveCreate({
        url: 'https://example.com/',
        title: 'Example',
        partition: 'persist:vimeflow-browser:proj-1:pty-shell',
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
})
