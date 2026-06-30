import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { useState, type ReactElement } from 'react'
import type { PaneLayoutId } from '../../../sessions/types'
import {
  PaneLayoutRegistry,
  type PaneLayoutDefinition,
} from '../../layout-registry'
import { LayoutDisplayMenu } from './LayoutDisplayMenu'

let restorePlatform: (() => void) | null = null
let nativeOverlayActionListener: ((event: unknown) => void) | null = null

interface CapturedNativeOverlayMenuAction {
  id: string
  label: string
  icon?: string
  pressed?: boolean
}

interface CapturedNativeOverlayMenuItem {
  type?: string
  id?: string
  label?: string
  icon?: string
  actions?: readonly CapturedNativeOverlayMenuAction[]
}

interface CapturedNativeOverlayRequest {
  surfaceId: string
  anchorRect: { x: number; y: number; width: number; height: number }
  placement: string
  payload: {
    sections?: readonly {
      items: readonly CapturedNativeOverlayMenuItem[]
    }[]
  }
}

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
  action: (event: unknown) => void
} => {
  const open = vi.fn().mockResolvedValue({ accepted: true })

  window.vimeflow = {
    invoke: <T,>(): Promise<T> => Promise.resolve(null as T),
    listen: vi.fn(() => Promise.resolve(vi.fn())),
    nativeOverlay: {
      open,
      close: vi.fn().mockResolvedValue(undefined),
      onAction: vi.fn((callback: (event: unknown) => void) => {
        nativeOverlayActionListener = callback

        return vi.fn()
      }),
      onClose: vi.fn(() => vi.fn()),
    },
  }

  return {
    open,
    action: (event): void => {
      nativeOverlayActionListener?.(event)
    },
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
  restorePlatform?.()
  restorePlatform = null
  delete window.vimeflow
})

const customMainBottomLayout: PaneLayoutDefinition = {
  schemaVersion: 1,
  id: 'custom:main-bottom',
  title: 'Main + bottom',
  source: 'workspace',
  tracks: {
    columns: [
      { id: 'col-0', units: 8 },
      { id: 'col-1', units: 8 },
      { id: 'col-2', units: 8 },
    ],
    rows: [
      { id: 'row-0', units: 16 },
      { id: 'row-1', units: 8 },
    ],
  },
  slots: [
    { id: 'slot:p0', rect: { col: 0, row: 0, colSpan: 3, rowSpan: 1 } },
    { id: 'slot:p1', rect: { col: 0, row: 1, colSpan: 1, rowSpan: 1 } },
    { id: 'slot:p2', rect: { col: 1, row: 1, colSpan: 1, rowSpan: 1 } },
    { id: 'slot:p3', rect: { col: 2, row: 1, colSpan: 1, rowSpan: 1 } },
  ],
  addOrder: ['slot:p0', 'slot:p1', 'slot:p2', 'slot:p3'],
}

interface HarnessProps {
  activeLayoutId?: PaneLayoutId
  initialVisibleLayoutIds?: readonly PaneLayoutId[]
  blockedLayoutIds?: readonly PaneLayoutId[]
  layouts?: readonly PaneLayoutDefinition[]
  onPickLayout?: (layoutId: PaneLayoutId) => boolean
  onEditCustomLayout?: (layoutId: PaneLayoutId) => void
  onDuplicateCustomLayout?: (layoutId: PaneLayoutId) => void
  onDeleteCustomLayout?: (layoutId: PaneLayoutId) => void
  onCreateCustomLayout?: () => void
  nativeOverlay?: boolean
}

const LayoutDisplayMenuHarness = ({
  activeLayoutId = 'vsplit',
  initialVisibleLayoutIds = [
    'single',
    'vsplit',
    'hsplit',
    'threeRight',
    'quad',
    'grid3x2',
  ],
  blockedLayoutIds = [],
  layouts = [],
  onPickLayout = undefined,
  onEditCustomLayout = undefined,
  onDuplicateCustomLayout = undefined,
  onDeleteCustomLayout = undefined,
  onCreateCustomLayout = undefined,
  nativeOverlay = false,
}: HarnessProps): ReactElement => {
  const [visibleLayoutIds, setVisibleLayoutIds] = useState(
    initialVisibleLayoutIds
  )

  const [hiddenCustomLayoutIds, setHiddenCustomLayoutIds] = useState<
    readonly PaneLayoutId[]
  >([])
  const registry = new PaneLayoutRegistry(layouts)

  return (
    <>
      <LayoutDisplayMenu
        activeLayoutId={activeLayoutId}
        visibleLayoutIds={visibleLayoutIds}
        blockedLayoutIds={blockedLayoutIds}
        hiddenCustomLayoutIds={hiddenCustomLayoutIds}
        layouts={registry.layouts}
        onVisibleLayoutIdsChange={setVisibleLayoutIds}
        onHiddenCustomLayoutIdsChange={setHiddenCustomLayoutIds}
        onPickLayout={onPickLayout}
        onEditCustomLayout={onEditCustomLayout}
        onDuplicateCustomLayout={onDuplicateCustomLayout}
        onDeleteCustomLayout={onDeleteCustomLayout}
        onCreateCustomLayout={onCreateCustomLayout}
        nativeOverlay={nativeOverlay}
      />
      <output>{visibleLayoutIds.join(',')}</output>
      <output>{hiddenCustomLayoutIds.join(',')}</output>
    </>
  )
}

describe('LayoutDisplayMenu', () => {
  test('shows all layout rows with glyph labels and checkboxes', async () => {
    const user = userEvent.setup()

    render(<LayoutDisplayMenuHarness />)

    await user.click(
      screen.getByRole('button', { name: 'Configure displayed layouts' })
    )

    const menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitemcheckbox')).toHaveLength(6)

    expect(
      within(menu).getByRole('menuitemcheckbox', { name: '3x2 grid' })
    ).toBeInTheDocument()
  })

  test('keeps single checked and disabled as the required baseline layout', async () => {
    const user = userEvent.setup()

    render(<LayoutDisplayMenuHarness activeLayoutId="vsplit" />)

    await user.click(
      screen.getByRole('button', { name: 'Configure displayed layouts' })
    )

    const singleLayout = await screen.findByRole('menuitemcheckbox', {
      name: 'Single',
    })

    expect(singleLayout).toHaveAttribute('aria-disabled', 'true')
    expect(singleLayout).toHaveAttribute('aria-checked', 'true')

    await user.click(singleLayout)

    expect(
      screen.getByText('single,vsplit,hsplit,threeRight,quad,grid3x2')
    ).toBeInTheDocument()
  })

  test('lets grid3x2 be hidden even though it starts visible by default', async () => {
    const user = userEvent.setup()

    render(<LayoutDisplayMenuHarness />)

    await user.click(
      screen.getByRole('button', { name: 'Configure displayed layouts' })
    )

    const gridLayout = await screen.findByRole('menuitemcheckbox', {
      name: '3x2 grid',
    })

    expect(gridLayout).not.toHaveAttribute('aria-disabled', 'true')
    expect(gridLayout).toHaveAttribute('aria-checked', 'true')

    await user.click(gridLayout)

    expect(
      screen.getByText('single,vsplit,hsplit,threeRight,quad')
    ).toBeInTheDocument()
  })

  test('toggling a non-active layout updates the visible layout list', async () => {
    const user = userEvent.setup()

    render(<LayoutDisplayMenuHarness />)

    await user.click(
      screen.getByRole('button', { name: 'Configure displayed layouts' })
    )

    await user.click(
      await screen.findByRole('menuitemcheckbox', { name: 'Quad' })
    )

    expect(
      screen.getByText('single,vsplit,hsplit,threeRight,grid3x2')
    ).toBeInTheDocument()
  })

  test('keeps a capacity-blocked built-in checkbox freely toggled (visibility only)', async () => {
    const user = userEvent.setup()

    render(
      <LayoutDisplayMenuHarness
        activeLayoutId="grid3x2"
        blockedLayoutIds={['quad']}
      />
    )

    await user.click(
      screen.getByRole('button', { name: 'Configure displayed layouts' })
    )

    const quad = await screen.findByRole('menuitemcheckbox', { name: 'Quad' })

    // The display menu is a pure visibility toggle — capacity does not grey
    // built-in checkboxes. Toggling Quad off updates the visible-layout list.
    expect(quad).not.toHaveAttribute('aria-disabled', 'true')

    await user.click(quad)

    expect(
      screen.getByText('single,vsplit,hsplit,threeRight,grid3x2')
    ).toBeInTheDocument()
  })

  test('normalizes the required single layout back into the visible list when callers omitted it', async () => {
    const user = userEvent.setup()

    render(
      <LayoutDisplayMenuHarness
        initialVisibleLayoutIds={['vsplit', 'hsplit', 'threeRight']}
      />
    )

    await user.click(
      screen.getByRole('button', { name: 'Configure displayed layouts' })
    )

    await waitFor(() => {
      expect(
        screen.getByText('single,vsplit,hsplit,threeRight')
      ).toBeInTheDocument()
    })
  })

  test('shows custom layout actions and persists hidden custom ids', async () => {
    const user = userEvent.setup()
    const onPickLayout = vi.fn(() => true)
    const onEditCustomLayout = vi.fn()
    const onDeleteCustomLayout = vi.fn()
    const onCreateCustomLayout = vi.fn()

    render(
      <LayoutDisplayMenuHarness
        layouts={[customMainBottomLayout]}
        onPickLayout={onPickLayout}
        onEditCustomLayout={onEditCustomLayout}
        onDeleteCustomLayout={onDeleteCustomLayout}
        onCreateCustomLayout={onCreateCustomLayout}
      />
    )

    const openMenu = async (): Promise<void> => {
      await user.click(
        screen.getByRole('button', { name: 'Configure displayed layouts' })
      )
    }

    await openMenu()
    await user.click(screen.getByRole('button', { name: 'Main + bottom' }))

    await openMenu()
    await user.click(screen.getByRole('button', { name: 'Edit Main + bottom' }))

    await openMenu()

    const trigger = screen.getByRole('button', {
      name: 'Configure displayed layouts',
    })
    await user.click(
      screen.getByRole('button', { name: 'Delete Main + bottom' })
    )

    expect(trigger).toHaveFocus()

    await openMenu()
    await user.click(
      screen.getByRole('button', {
        name: 'Hide Main + bottom from switcher',
      })
    )

    expect(onPickLayout).toHaveBeenCalledWith('custom:main-bottom')
    expect(onEditCustomLayout).toHaveBeenCalledWith('custom:main-bottom')
    expect(onDeleteCustomLayout).toHaveBeenCalledWith('custom:main-bottom')
    expect(screen.getByText('custom:main-bottom')).toBeInTheDocument()

    await user.click(
      screen.getByRole('menuitem', { name: 'Create custom layout' })
    )

    expect(onCreateCustomLayout).toHaveBeenCalledOnce()
    expect(trigger).toHaveFocus()
  })

  test('duplicating a custom layout invokes onDuplicateCustomLayout and closes the menu', async () => {
    const user = userEvent.setup()
    const onDuplicateCustomLayout = vi.fn()

    render(
      <LayoutDisplayMenuHarness
        layouts={[customMainBottomLayout]}
        onDuplicateCustomLayout={onDuplicateCustomLayout}
      />
    )

    const trigger = screen.getByRole('button', {
      name: 'Configure displayed layouts',
    })
    await user.click(trigger)

    await user.click(
      await screen.findByRole('button', { name: 'Duplicate Main + bottom' })
    )

    expect(onDuplicateCustomLayout).toHaveBeenCalledWith('custom:main-bottom')
    expect(trigger).toHaveFocus()
  })

  test('does not close or pick a blocked custom layout row', async () => {
    const user = userEvent.setup()
    const onPickLayout = vi.fn(() => true)

    render(
      <LayoutDisplayMenuHarness
        blockedLayoutIds={['custom:main-bottom']}
        layouts={[customMainBottomLayout]}
        onPickLayout={onPickLayout}
      />
    )

    await user.click(
      screen.getByRole('button', { name: 'Configure displayed layouts' })
    )

    await user.click(
      await screen.findByRole('button', { name: 'Main + bottom' })
    )

    expect(onPickLayout).not.toHaveBeenCalled()
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  test('arrow-key navigation reaches custom layout rows', async () => {
    const user = userEvent.setup()

    render(<LayoutDisplayMenuHarness layouts={[customMainBottomLayout]} />)

    screen.getByRole('button', { name: 'Configure displayed layouts' }).focus()
    await user.keyboard('{ArrowDown}')
    await screen.findByRole('menu')

    await user.keyboard(
      '{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}'
    )

    expect(
      screen.getByRole('menuitem', { name: 'Main + bottom' })
    ).toHaveFocus()
  })

  test('serializes the built-in layout display menu for native overlay', async () => {
    vi.stubEnv('VITE_NATIVE_OVERLAY', '1')
    setNavigatorPlatform('MacIntel')
    const nativeBridge = installNativeOverlayBridge()
    const user = userEvent.setup()

    render(
      <LayoutDisplayMenuHarness nativeOverlay onCreateCustomLayout={vi.fn()} />
    )

    const trigger = screen.getByRole('button', {
      name: 'Configure displayed layouts',
    })
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      x: 11,
      y: 22,
      width: 24,
      height: 20,
      top: 22,
      left: 11,
      right: 35,
      bottom: 42,
      toJSON: () => ({}),
    } as DOMRect)

    await user.click(trigger)
    await waitFor(() => expect(nativeBridge.open).toHaveBeenCalledOnce())

    const request = nativeBridge.open.mock.calls[0][0] as {
      anchorRect: { x: number; y: number; width: number; height: number }
      placement: string
      payload: unknown
    }
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(request).toMatchObject({
      anchorRect: { x: 11, y: 22, width: 24, height: 20 },
      placement: 'bottom-end',
      payload: {
        kind: 'menu',
        ariaLabel: 'Displayed layouts',
        sections: [
          {
            label: 'Displayed layouts',
            items: expect.arrayContaining([
              expect.objectContaining({
                type: 'checkbox',
                label: 'Quad',
                checked: true,
              }),
            ]),
          },
          {
            items: expect.arrayContaining([
              expect.objectContaining({
                label: 'Create custom layout',
                icon: 'dashboard_customize',
              }),
            ]),
          },
        ],
      },
    })
  })

  test('serializes custom layout rows for native overlay actions', async () => {
    vi.stubEnv('VITE_NATIVE_OVERLAY', '1')
    setNavigatorPlatform('MacIntel')
    const nativeBridge = installNativeOverlayBridge()
    const onPickLayout = vi.fn(() => true)
    const onDuplicateCustomLayout = vi.fn()
    const user = userEvent.setup()

    render(
      <LayoutDisplayMenuHarness
        layouts={[customMainBottomLayout]}
        nativeOverlay
        onPickLayout={onPickLayout}
        onDuplicateCustomLayout={onDuplicateCustomLayout}
      />
    )

    const trigger = screen.getByRole('button', {
      name: 'Configure displayed layouts',
    })

    await user.click(trigger)
    await waitFor(() => expect(nativeBridge.open).toHaveBeenCalledOnce())

    const firstRequest = nativeBridge.open.mock
      .calls[0][0] as CapturedNativeOverlayRequest

    const customRow = firstRequest.payload.sections
      ?.flatMap((section) => section.items)
      .find((item) => item.type === 'composite')

    expect(customRow).toMatchObject({
      type: 'composite',
      id: expect.any(String),
      label: 'Main + bottom',
      icon: 'dashboard',
      actions: [
        expect.objectContaining({
          id: expect.any(String),
          label: 'Edit Main + bottom',
          icon: 'edit',
        }),
        expect.objectContaining({
          id: expect.any(String),
          label: 'Duplicate Main + bottom',
          icon: 'content_copy',
        }),
        expect.objectContaining({
          id: expect.any(String),
          label: 'Delete Main + bottom',
          icon: 'delete',
        }),
        expect.objectContaining({
          id: expect.any(String),
          label: 'Hide Main + bottom from switcher',
          icon: 'visibility',
          pressed: true,
        }),
      ],
    })

    if (customRow?.type !== 'composite' || customRow.actions === undefined) {
      throw new Error('expected custom layout composite row')
    }

    const duplicateAction = customRow.actions.find(
      (action) => action.label === 'Duplicate Main + bottom'
    )

    act(() => {
      nativeBridge.action({
        surfaceId: firstRequest.surfaceId,
        actionId: duplicateAction?.id ?? '',
      })
    })

    expect(onDuplicateCustomLayout).toHaveBeenCalledWith('custom:main-bottom')

    await user.click(trigger)
    await waitFor(() => expect(nativeBridge.open).toHaveBeenCalledTimes(2))

    const secondRequest = nativeBridge.open.mock
      .calls[1][0] as CapturedNativeOverlayRequest

    const secondCustomRow = secondRequest.payload.sections
      ?.flatMap((section) => section.items)
      .find((item) => item.type === 'composite')

    act(() => {
      nativeBridge.action({
        surfaceId: secondRequest.surfaceId,
        actionId:
          secondCustomRow?.type === 'composite' ? secondCustomRow.id : '',
      })
    })

    expect(onPickLayout).toHaveBeenCalledWith('custom:main-bottom')

    await user.click(trigger)
    await waitFor(() => expect(nativeBridge.open).toHaveBeenCalledTimes(3))

    const thirdRequest = nativeBridge.open.mock
      .calls[2][0] as CapturedNativeOverlayRequest

    const thirdCustomRow = thirdRequest.payload.sections
      ?.flatMap((section) => section.items)
      .find((item) => item.type === 'composite')

    const toggleAction =
      thirdCustomRow?.type === 'composite'
        ? thirdCustomRow.actions?.find((action) =>
            action.label.startsWith('Hide ')
          )
        : undefined

    act(() => {
      nativeBridge.action({
        surfaceId: thirdRequest.surfaceId,
        actionId: toggleAction?.id ?? '',
      })
    })

    expect(screen.getByText('custom:main-bottom')).toBeInTheDocument()
  })
})
