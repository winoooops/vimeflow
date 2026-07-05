import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { useRef, useState, type ReactElement } from 'react'
import { Menu } from '@/components/Menu'
import type { PaneLayoutId } from '../../../sessions/types'
import {
  PaneLayoutRegistry,
  createMainBottomRowTemplate,
  type LayoutShape,
} from '../../layout-registry'
import { customLayoutMenuItems } from './LayoutDisplayCustomLayouts'

let restorePlatform: (() => void) | null = null

interface NativeOverlayAction {
  id: string
  label: string
  icon?: string
  pressed?: boolean
}

interface NativeOverlayCompositeItem {
  type: 'composite'
  id: string
  label: string
  icon?: string
  actions?: readonly NativeOverlayAction[]
}

interface CapturedNativeOverlayMenuSection {
  items: readonly CapturedNativeOverlayMenuItem[]
}

interface CapturedNativeOverlayMenuItem {
  type?: string
  id?: string
  label?: string
  icon?: string
  actions?: readonly NativeOverlayAction[]
}

interface CapturedNativeOverlayRequest {
  surfaceId: string
  payload: {
    sections?: readonly CapturedNativeOverlayMenuSection[]
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
  let actionListener: ((event: unknown) => void) | null = null
  const open = vi.fn().mockResolvedValue({ accepted: true })

  window.vimeflow = {
    invoke: <T,>(): Promise<T> => Promise.resolve(null as T),
    listen: vi.fn(() => Promise.resolve(vi.fn())),
    nativeOverlay: {
      open,
      close: vi.fn().mockResolvedValue(undefined),
      actionResult: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn().mockResolvedValue(undefined),
      onAction: vi.fn((callback: (event: unknown) => void) => {
        actionListener = callback

        return vi.fn()
      }),
      onClose: vi.fn(() => vi.fn()),
    },
  }

  return {
    open,
    action: (event): void => {
      actionListener?.(event)
    },
  }
}

const customLayouts = (): readonly LayoutShape[] =>
  new PaneLayoutRegistry([createMainBottomRowTemplate()]).layouts.filter(
    (layout) => layout.definition.source === 'workspace'
  )

interface CustomLayoutsHarnessProps {
  activeLayoutId?: PaneLayoutId
  blockedLayoutIds?: readonly PaneLayoutId[]
  initialHiddenCustomLayoutIds?: readonly PaneLayoutId[]
  onPickLayout?: (layoutId: PaneLayoutId) => boolean
  onEditCustomLayout?: (layoutId: PaneLayoutId) => void
  onDuplicateCustomLayout?: (layoutId: PaneLayoutId) => void
  onDeleteCustomLayout?: (layoutId: PaneLayoutId) => void
  nativeOverlay?: boolean
}

const CustomLayoutsHarness = ({
  activeLayoutId = 'single',
  blockedLayoutIds = [],
  initialHiddenCustomLayoutIds = [],
  onPickLayout = undefined,
  onEditCustomLayout = undefined,
  onDuplicateCustomLayout = undefined,
  onDeleteCustomLayout = undefined,
  nativeOverlay = false,
}: CustomLayoutsHarnessProps): ReactElement => {
  const [hiddenCustomLayoutIds, setHiddenCustomLayoutIds] = useState(
    initialHiddenCustomLayoutIds
  )
  const [closeSignal, setCloseSignal] = useState(0)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const closeMenu = (): void => {
    triggerRef.current?.focus()
    setCloseSignal((signal) => signal + 1)
  }

  return (
    <>
      <Menu
        trigger={
          <button ref={triggerRef} type="button">
            Open custom layouts
          </button>
        }
        closeSignal={closeSignal}
        nativeOverlay={nativeOverlay}
      >
        <Menu.Section label="Custom">
          {customLayoutMenuItems({
            customLayouts: customLayouts(),
            activeLayoutId,
            blockedLayoutIds,
            hiddenCustomLayoutIds,
            onHiddenCustomLayoutIdsChange: setHiddenCustomLayoutIds,
            onPickLayout,
            onEditCustomLayout,
            onDuplicateCustomLayout,
            onDeleteCustomLayout,
            closeMenu,
          })}
        </Menu.Section>
      </Menu>
      <output aria-label="Hidden custom layout ids">
        {hiddenCustomLayoutIds.join(',')}
      </output>
    </>
  )
}

const findCustomNativeOverlayRow = (
  request: CapturedNativeOverlayRequest
): NativeOverlayCompositeItem => {
  const item = request.payload.sections
    ?.flatMap((section) => section.items)
    .find((candidate) => candidate.type === 'composite')

  if (item?.type !== 'composite') {
    throw new Error('expected custom layout composite row')
  }

  return item as NativeOverlayCompositeItem
}

afterEach(() => {
  vi.unstubAllEnvs()
  restorePlatform?.()
  restorePlatform = null
  delete window.vimeflow
})

describe('customLayoutMenuItems', () => {
  test('dispatches custom layout row and action callbacks', async () => {
    const user = userEvent.setup()
    const onPickLayout = vi.fn(() => true)
    const onEditCustomLayout = vi.fn()
    const onDuplicateCustomLayout = vi.fn()
    const onDeleteCustomLayout = vi.fn()

    render(
      <CustomLayoutsHarness
        onPickLayout={onPickLayout}
        onEditCustomLayout={onEditCustomLayout}
        onDuplicateCustomLayout={onDuplicateCustomLayout}
        onDeleteCustomLayout={onDeleteCustomLayout}
      />
    )

    const trigger = screen.getByRole('button', { name: 'Open custom layouts' })

    const openMenu = async (): Promise<void> => {
      await user.click(trigger)
    }

    await openMenu()
    await user.click(screen.getByRole('button', { name: 'Main + bottom row' }))

    await openMenu()
    await user.click(
      screen.getByRole('button', { name: 'Edit Main + bottom row' })
    )

    await openMenu()
    await user.click(
      screen.getByRole('button', { name: 'Duplicate Main + bottom row' })
    )

    await openMenu()
    await user.click(
      screen.getByRole('button', { name: 'Delete Main + bottom row' })
    )

    expect(onPickLayout).toHaveBeenCalledWith('custom:template-main-bottom-row')
    expect(onEditCustomLayout).toHaveBeenCalledWith(
      'custom:template-main-bottom-row'
    )

    expect(onDuplicateCustomLayout).toHaveBeenCalledWith(
      'custom:template-main-bottom-row'
    )

    expect(onDeleteCustomLayout).toHaveBeenCalledWith(
      'custom:template-main-bottom-row'
    )
    expect(trigger).toHaveFocus()
  })

  test('persists hidden custom layout ids without closing the local menu', async () => {
    const user = userEvent.setup()

    render(<CustomLayoutsHarness />)

    await user.click(
      screen.getByRole('button', { name: 'Open custom layouts' })
    )

    await user.click(
      screen.getByRole('button', {
        name: 'Hide Main + bottom row from switcher',
      })
    )

    expect(screen.getByLabelText('Hidden custom layout ids')).toHaveTextContent(
      'custom:template-main-bottom-row'
    )
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  test('does not close or pick a blocked custom layout row', async () => {
    const user = userEvent.setup()
    const onPickLayout = vi.fn(() => true)

    render(
      <CustomLayoutsHarness
        blockedLayoutIds={['custom:template-main-bottom-row']}
        onPickLayout={onPickLayout}
      />
    )

    await user.click(
      screen.getByRole('button', { name: 'Open custom layouts' })
    )

    await user.click(
      await screen.findByRole('button', { name: 'Main + bottom row' })
    )

    expect(onPickLayout).not.toHaveBeenCalled()
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  test('serializes custom layout rows for native overlay actions', async () => {
    vi.stubEnv('VITE_NATIVE_OVERLAY', '1')
    setNavigatorPlatform('MacIntel')
    const nativeBridge = installNativeOverlayBridge()
    const onPickLayout = vi.fn(() => true)
    const onDuplicateCustomLayout = vi.fn()
    const user = userEvent.setup()

    render(
      <CustomLayoutsHarness
        nativeOverlay
        onPickLayout={onPickLayout}
        onDuplicateCustomLayout={onDuplicateCustomLayout}
      />
    )

    const trigger = screen.getByRole('button', { name: 'Open custom layouts' })
    await user.click(trigger)
    await waitFor(() => expect(nativeBridge.open).toHaveBeenCalledOnce())

    const firstRequest = nativeBridge.open.mock
      .calls[0][0] as CapturedNativeOverlayRequest
    const customRow = findCustomNativeOverlayRow(firstRequest)

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(customRow).toMatchObject({
      type: 'composite',
      id: expect.any(String),
      label: 'Main + bottom row',
      icon: 'dashboard',
      actions: [
        expect.objectContaining({
          id: expect.any(String),
          label: 'Edit Main + bottom row',
          icon: 'edit',
        }),
        expect.objectContaining({
          id: expect.any(String),
          label: 'Duplicate Main + bottom row',
          icon: 'content_copy',
        }),
        expect.objectContaining({
          id: expect.any(String),
          label: 'Delete Main + bottom row',
          icon: 'delete',
        }),
        expect.objectContaining({
          id: expect.any(String),
          label: 'Hide Main + bottom row from switcher',
          icon: 'visibility',
          pressed: true,
        }),
      ],
    })

    const duplicateAction = customRow.actions?.find(
      (action) => action.label === 'Duplicate Main + bottom row'
    )

    act(() => {
      nativeBridge.action({
        surfaceId: firstRequest.surfaceId,
        actionId: duplicateAction?.id ?? '',
      })
    })

    expect(onDuplicateCustomLayout).toHaveBeenCalledWith(
      'custom:template-main-bottom-row'
    )

    await user.click(trigger)
    await waitFor(() => expect(nativeBridge.open).toHaveBeenCalledTimes(2))

    const secondRequest = nativeBridge.open.mock
      .calls[1][0] as CapturedNativeOverlayRequest
    const secondCustomRow = findCustomNativeOverlayRow(secondRequest)

    act(() => {
      nativeBridge.action({
        surfaceId: secondRequest.surfaceId,
        actionId: secondCustomRow.id,
      })
    })

    expect(onPickLayout).toHaveBeenCalledWith('custom:template-main-bottom-row')
  })
})
