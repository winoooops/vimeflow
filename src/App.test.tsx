import type { ReactElement } from 'react'
import { render, screen } from '@testing-library/react'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from 'vitest'
import App from './App'

// Mock WorkspaceView to avoid rendering the full workspace in App tests.
vi.mock('./features/workspace/WorkspaceView', () => {
  const MockedWorkspaceView = (): ReactElement => (
    <div data-testid="workspace-view">Mocked WorkspaceView</div>
  )

  return {
    WorkspaceView: MockedWorkspaceView,
    default: MockedWorkspaceView,
  }
})

vi.mock('./features/sessions/demo/ReorderMotionDemo', () => {
  const MockedReorderMotionDemo = (): ReactElement => (
    <div data-testid="session-reorder-demo">Session reorder demo</div>
  )

  return {
    ReorderMotionDemo: MockedReorderMotionDemo,
  }
})

class TestWorker {
  constructor(readonly url: string | URL) {}

  postMessage(): void {
    // No-op test worker stub.
  }

  terminate(): void {
    // No-op test worker stub.
  }

  addEventListener(): void {
    // No-op test worker stub.
  }

  removeEventListener(): void {
    // No-op test worker stub.
  }

  dispatchEvent(): boolean {
    return true
  }
}

const withNavigatorPlatform = (
  platform: string,
  callback: () => void
): void => {
  const originalNavigator = globalThis.navigator

  const mockedNavigator = Object.create(originalNavigator) as Navigator & {
    userAgentData?: { platform?: string }
  }

  Object.defineProperty(mockedNavigator, 'platform', {
    configurable: true,
    value: platform,
  })

  Object.defineProperty(mockedNavigator, 'userAgentData', {
    configurable: true,
    value: { platform },
  })

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: mockedNavigator,
  })

  try {
    callback()
  } finally {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: originalNavigator,
    })
  }
}

describe('App', () => {
  beforeAll(() => {
    vi.stubGlobal('Worker', TestWorker)
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    window.history.replaceState(null, '', '/')
  })

  test('renders without crashing', () => {
    render(<App />)
    expect(document.body).toBeTruthy()
  })

  test('renders WorkspaceView as primary component', () => {
    render(<App />)
    expect(screen.getByTestId('workspace-view')).toBeInTheDocument()
  })

  test('renders settings content for the native settings window route', () => {
    window.history.replaceState(null, '', '/?window=settings')

    render(<App />)

    expect(screen.getByRole('main', { name: 'Settings' })).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Appearance' })
    ).toBeInTheDocument()
    expect(screen.queryByTestId('workspace-view')).not.toBeInTheDocument()
  })

  test('reserves native macOS traffic light space in the settings window route', () => {
    withNavigatorPlatform('MacIntel', () => {
      window.history.replaceState(null, '', '/?window=settings')

      render(<App />)

      expect(screen.getByTestId('settings-window-drag-region')).toHaveClass(
        'vf-app-drag-region'
      )

      expect(
        screen.getByTestId('settings-window-sidebar-drag-region')
      ).toHaveClass(
        'w-[220px]',
        'border-r',
        'border-outline-variant/25',
        'bg-surface-container'
      )

      expect(
        screen.getByTestId('settings-window-content-drag-region')
      ).toHaveClass('flex-1', 'bg-surface')
    })
  })

  test('is an arrow-function component', () => {
    expect(typeof App).toBe('function')
    expect(App.prototype).toBeUndefined()
  })

  test('does not render placeholder content', () => {
    render(<App />)
    expect(
      screen.queryByText('Vimeflow Workspace (Phase 2)')
    ).not.toBeInTheDocument()

    expect(
      screen.queryByText('Workspace layout components will be added next')
    ).not.toBeInTheDocument()
  })

  test('renders session reorder demo behind dev query gate', () => {
    window.history.replaceState(null, '', '/?demo=session-reorder')

    render(<App />)

    expect(screen.getByTestId('session-reorder-demo')).toBeInTheDocument()
    expect(screen.queryByTestId('workspace-view')).not.toBeInTheDocument()
  })
})
