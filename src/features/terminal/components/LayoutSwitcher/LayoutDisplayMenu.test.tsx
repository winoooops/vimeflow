import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Menu } from '@/components/Menu'
import type { PaneLayoutId } from '../../../sessions/types'
import {
  PaneLayoutRegistry,
  createMainBottomRowTemplate,
  type LayoutShape,
} from '../../layout-registry'
import { LayoutDisplayMenu } from './LayoutDisplayMenu'

interface BuiltInLayoutBuilderOptions {
  builtInLayouts: readonly LayoutShape[]
  allLayouts: readonly LayoutShape[]
  activeLayoutId: PaneLayoutId
  visibleLayoutIds: readonly PaneLayoutId[]
}

interface CustomLayoutBuilderOptions {
  customLayouts: readonly LayoutShape[]
  activeLayoutId: PaneLayoutId
  blockedLayoutIds: readonly PaneLayoutId[]
  hiddenCustomLayoutIds: readonly PaneLayoutId[]
}

interface NativeMenuTestRow {
  type?: string
  id: string
  label?: string
}

interface NativeMenuTestRequest {
  surfaceId: string
  payload: {
    kind: 'menu'
    items?: readonly NativeMenuTestRow[]
    sections?: readonly { items: readonly NativeMenuTestRow[] }[]
  }
}

const builderMocks = vi.hoisted(() => ({
  builtInLayoutMenuItems: vi.fn(),
  customLayoutMenuItems: vi.fn(),
}))

let restorePlatform: (() => void) | null = null

const setNavigatorPlatform = (platform: string): void => {
  restorePlatform?.()
  const original = Object.getOwnPropertyDescriptor(window.navigator, 'platform')

  Object.defineProperty(window.navigator, 'platform', {
    configurable: true,
    value: platform,
  })

  restorePlatform = (): void => {
    if (original === undefined) {
      delete (window.navigator as unknown as { platform?: string }).platform

      return
    }

    Object.defineProperty(window.navigator, 'platform', original)
  }
}

const installNativeOverlayBridge = (): {
  open: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  action: (event: unknown) => void
} => {
  let actionListener: ((event: unknown) => void) | null = null
  const open = vi.fn().mockResolvedValue({ accepted: true })
  const close = vi.fn().mockResolvedValue(undefined)

  window.vimeflow = {
    invoke: <T,>(): Promise<T> => Promise.resolve(null as T),
    listen: vi.fn(() => Promise.resolve(vi.fn())),
    nativeOverlay: {
      open,
      close,
      actionResult: vi.fn(() => Promise.resolve()),
      resume: vi.fn(() => Promise.resolve()),
      onAction: vi.fn((callback: (event: unknown) => void) => {
        actionListener = callback

        return vi.fn()
      }),
      onClose: vi.fn(() => vi.fn()),
    },
  }

  return {
    open,
    close,
    action: (event): void => {
      actionListener?.(event)
    },
  }
}

const nativeMenuRequestAt = (
  open: ReturnType<typeof vi.fn>,
  index = 0
): NativeMenuTestRequest => {
  const request = open.mock.calls[index]?.[0] as unknown
  if (
    !(
      typeof request === 'object' &&
      request !== null &&
      'payload' in request &&
      (request as NativeMenuTestRequest).payload?.kind === 'menu'
    )
  ) {
    throw new Error('expected native overlay menu request')
  }

  return request as NativeMenuTestRequest
}

const nativeMenuRows = (
  request: NativeMenuTestRequest
): readonly NativeMenuTestRow[] => [
  ...(request.payload.items ?? []),
  ...(request.payload.sections ?? []).flatMap((section) => section.items),
]

vi.mock('./LayoutDisplayBuiltInLayouts', () => ({
  builtInLayoutMenuItems: builderMocks.builtInLayoutMenuItems,
}))

vi.mock('./LayoutDisplayCustomLayouts', () => ({
  customLayoutMenuItems: builderMocks.customLayoutMenuItems,
}))

describe('LayoutDisplayMenu', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    restorePlatform?.()
    restorePlatform = null
    delete window.vimeflow
  })

  beforeEach(() => {
    builderMocks.builtInLayoutMenuItems.mockReset()
    builderMocks.customLayoutMenuItems.mockReset()
    builderMocks.builtInLayoutMenuItems.mockReturnValue([
      <Menu.Item key="built-in-placeholder" onSelect={vi.fn()}>
        Built-in builder item
      </Menu.Item>,
    ])

    builderMocks.customLayoutMenuItems.mockReturnValue([
      <Menu.Item key="custom-placeholder" onSelect={vi.fn()}>
        Custom builder item
      </Menu.Item>,
    ])
  })

  test('renders the layout display menu button', () => {
    render(
      <LayoutDisplayMenu
        activeLayoutId="vsplit"
        visibleLayoutIds={['single', 'vsplit']}
        onVisibleLayoutIdsChange={vi.fn()}
      />
    )

    expect(
      screen.getByRole('button', { name: 'Configure displayed layouts' })
    ).toBeInTheDocument()
  })

  test('opens the menu shell with items from the built-in and custom builders', async () => {
    const user = userEvent.setup()
    const registry = new PaneLayoutRegistry([createMainBottomRowTemplate()])

    render(
      <LayoutDisplayMenu
        activeLayoutId="custom:template-main-bottom-row"
        visibleLayoutIds={['single', 'vsplit', 'hsplit']}
        blockedLayoutIds={['custom:template-main-bottom-row']}
        hiddenCustomLayoutIds={['custom:template-main-bottom-row']}
        layouts={registry.layouts}
        onVisibleLayoutIdsChange={vi.fn()}
        onHiddenCustomLayoutIdsChange={vi.fn()}
        onPickLayout={vi.fn(() => true)}
        onEditCustomLayout={vi.fn()}
        onDuplicateCustomLayout={vi.fn()}
        onDeleteCustomLayout={vi.fn()}
      />
    )

    await user.click(
      screen.getByRole('button', { name: 'Configure displayed layouts' })
    )

    const menu = await screen.findByRole('menu')
    expect(
      within(menu).getByRole('menuitem', { name: 'Built-in builder item' })
    ).toBeInTheDocument()

    expect(
      within(menu).getByRole('menuitem', { name: 'Custom builder item' })
    ).toBeInTheDocument()

    expect(builderMocks.builtInLayoutMenuItems).toHaveBeenCalledOnce()

    const builtInOptions = builderMocks.builtInLayoutMenuItems.mock
      .calls[0][0] as BuiltInLayoutBuilderOptions

    expect(builtInOptions).toMatchObject({
      activeLayoutId: 'custom:template-main-bottom-row',
      visibleLayoutIds: ['single', 'vsplit', 'hsplit'],
    })

    expect(builtInOptions.builtInLayouts.map((layout) => layout.id)).toEqual([
      'single',
      'vsplit',
      'hsplit',
      'threeRight',
      'quad',
      'grid3x2',
    ])

    expect(builtInOptions.allLayouts.map((layout) => layout.id)).toContain(
      'custom:template-main-bottom-row'
    )

    expect(builderMocks.customLayoutMenuItems).toHaveBeenCalledOnce()

    const customOptions = builderMocks.customLayoutMenuItems.mock
      .calls[0][0] as CustomLayoutBuilderOptions

    expect(customOptions).toMatchObject({
      activeLayoutId: 'custom:template-main-bottom-row',
      blockedLayoutIds: ['custom:template-main-bottom-row'],
      hiddenCustomLayoutIds: ['custom:template-main-bottom-row'],
    })

    expect(customOptions.customLayouts.map((layout) => layout.id)).toEqual([
      'custom:template-main-bottom-row',
    ])
  })

  test('retains the native menu session while launching the layout creator dialog', async () => {
    vi.stubEnv('VITE_NATIVE_OVERLAY', '1')
    setNavigatorPlatform('MacIntel')
    const user = userEvent.setup()
    const nativeBridge = installNativeOverlayBridge()
    const onCreateCustomLayout = vi.fn()

    render(
      <LayoutDisplayMenu
        activeLayoutId="vsplit"
        visibleLayoutIds={['single', 'vsplit']}
        onVisibleLayoutIdsChange={vi.fn()}
        onCreateCustomLayout={onCreateCustomLayout}
        nativeOverlay
      />
    )

    await user.click(
      screen.getByRole('button', { name: 'Configure displayed layouts' })
    )
    await waitFor(() => expect(nativeBridge.open).toHaveBeenCalledOnce())

    const request = nativeMenuRequestAt(nativeBridge.open)

    const createItem = nativeMenuRows(request).find(
      (item) =>
        item.type !== 'separator' && item.label === 'Create custom layout'
    )
    expect(createItem).toMatchObject({
      id: expect.any(String),
      label: 'Create custom layout',
      closeOnSelect: false,
      suspendOnSelect: true,
    })

    act(() => {
      nativeBridge.action({
        surfaceId: request.surfaceId,
        actionId: createItem?.type === 'separator' ? '' : createItem?.id,
      })
    })

    expect(onCreateCustomLayout).toHaveBeenCalledOnce()
    expect(nativeBridge.close).not.toHaveBeenCalled()
  })

  test('opens the layout creator and lets the menu item own local close', async () => {
    const user = userEvent.setup()
    const onCreateCustomLayout = vi.fn()

    render(
      <LayoutDisplayMenu
        activeLayoutId="vsplit"
        visibleLayoutIds={['single', 'vsplit']}
        onVisibleLayoutIdsChange={vi.fn()}
        onCreateCustomLayout={onCreateCustomLayout}
      />
    )

    await user.click(
      screen.getByRole('button', { name: 'Configure displayed layouts' })
    )

    await user.click(
      await screen.findByRole('menuitem', { name: 'Create custom layout' })
    )

    expect(onCreateCustomLayout).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
