import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react'
import { IconButton } from '@/components/IconButton'
import { Menu } from '@/components/Menu'
import type {
  NativeOverlayMenuItem,
  NativeOverlayMenuSection,
  NativeOverlayRequest,
} from '@/components/base/floating/nativeOverlay'
import type { Placement } from '@/components/base/floating/glassSurface'
import { TOOLTIP_SUPPRESSED } from '@/lib/constants'

interface NativeOverlayHostBridge {
  ready: (request: { surfaceId: string }) => Promise<unknown>
  action: (request: { surfaceId: string; actionId: string }) => Promise<unknown>
  close: (request: { surfaceId: string; reason: 'outside' }) => Promise<unknown>
  onRender: (callback: (payload: unknown) => void) => () => void
  onClear: (callback: () => void) => () => void
}

const nativeOverlayHostBridge = (): NativeOverlayHostBridge | undefined =>
  window.vimeflow?.nativeOverlayHost

const isMenuRequest = (value: unknown): value is NativeOverlayRequest =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  (value as { kind?: unknown }).kind === 'menu' &&
  (value as { payload?: { kind?: unknown } }).payload?.kind === 'menu'

const OVERLAY_MENU_ROW_CLASSES =
  'flex min-h-8 w-full items-center justify-between gap-6 rounded px-2.5 py-1.5 ' +
  'text-left text-xs text-on-surface outline-none ring-0 transition-colors ' +
  'hover:bg-on-surface/10 focus:outline-none focus-visible:bg-on-surface/10 ' +
  'aria-disabled:cursor-default aria-disabled:text-on-surface-variant/45 ' +
  'aria-disabled:hover:bg-transparent aria-disabled:focus:bg-transparent'

const OVERLAY_MENU_SHORTCUT_CLASSES =
  'shrink-0 rounded bg-on-surface/10 px-1.5 py-0.5 font-mono text-[10px] ' +
  'text-on-surface-variant'

const OVERLAY_MENU_COMPOSITE_PRIMARY_CLASSES =
  'flex min-w-0 flex-1 items-center gap-2.5 rounded text-left outline-none ' +
  'focus-visible:ring-1 focus-visible:ring-primary disabled:cursor-default ' +
  'disabled:text-on-surface-variant/45'

const overlayMenuActionButtonClass = (pressed: boolean): string =>
  `inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] outline-none transition-colors focus-visible:ring-1 focus-visible:ring-primary disabled:cursor-default disabled:opacity-45 ${
    pressed
      ? 'bg-primary text-on-primary'
      : 'text-on-surface-muted hover:bg-on-surface/10 hover:text-primary'
  }`

const sectionsForRequest = (
  request: NativeOverlayRequest
): NativeOverlayMenuSection[] => {
  if (request.payload.sections !== undefined) {
    return [...request.payload.sections]
  }

  return [{ items: request.payload.items ?? [] }]
}

const isSeparatorItem = (
  item: NativeOverlayMenuItem
): item is Extract<NativeOverlayMenuItem, { type: 'separator' }> =>
  item.type === 'separator'

const isCheckboxItem = (
  item: NativeOverlayMenuItem
): item is Extract<NativeOverlayMenuItem, { type: 'checkbox' }> =>
  item.type === 'checkbox'

const isCompositeItem = (
  item: NativeOverlayMenuItem
): item is Extract<NativeOverlayMenuItem, { type: 'composite' }> =>
  item.type === 'composite'

export const NativeOverlayHost = (): ReactElement | null => {
  const [request, setRequest] = useState<NativeOverlayRequest | null>(null)
  const requestRef = useRef<NativeOverlayRequest | null>(null)
  requestRef.current = request

  useEffect(() => {
    document.body.dataset.nativeOverlayHost = 'true'

    return (): void => {
      delete document.body.dataset.nativeOverlayHost
    }
  }, [])

  useEffect(() => {
    const bridge = nativeOverlayHostBridge()
    if (!bridge) {
      return
    }

    const cleanupRender = bridge.onRender((payload) => {
      if (isMenuRequest(payload)) {
        setRequest(payload)
      }
    })

    const cleanupClear = bridge.onClear(() => {
      setRequest(null)
    })

    return (): void => {
      cleanupRender()
      cleanupClear()
    }
  }, [])

  useEffect(() => {
    if (request === null) {
      return
    }

    void nativeOverlayHostBridge()?.ready({ surfaceId: request.surfaceId })
  }, [request])

  const close = useCallback((): void => {
    const current = requestRef.current
    if (current === null) {
      return
    }

    setRequest(null)
    void nativeOverlayHostBridge()?.close({
      surfaceId: current.surfaceId,
      reason: 'outside',
    })
  }, [])

  if (request === null) {
    return null
  }

  const dispatchAction = (actionId: string): void => {
    setRequest(null)
    void nativeOverlayHostBridge()?.action({
      surfaceId: request.surfaceId,
      actionId,
    })
  }

  return (
    <Menu.Context
      position={request.anchorRect}
      placement={request.placement as Placement}
      open
      onOpenChange={(open): void => {
        if (!open) {
          close()
        }
      }}
      aria-label={request.payload.ariaLabel ?? 'Menu'}
    >
      {sectionsForRequest(request).map((section, sectionIndex) => (
        <Menu.Section
          key={`${request.surfaceId}:section:${String(sectionIndex)}`}
          label={section.label}
        >
          {section.items.map((item, itemIndex) => {
            const key = `${request.surfaceId}:section:${String(
              sectionIndex
            )}:item:${String(itemIndex)}`

            if (isSeparatorItem(item)) {
              return (
                <div
                  key={key}
                  aria-hidden="true"
                  className="mx-1 my-1 h-px bg-outline-variant/25"
                />
              )
            }

            if (isCheckboxItem(item)) {
              return (
                <Menu.Checkbox
                  key={item.id}
                  icon={item.icon}
                  checked={item.checked}
                  disabled={item.disabled}
                  aria-label={item.label}
                  onChange={(): void => {
                    if (item.disabled !== true) {
                      dispatchAction(item.id)
                    }
                  }}
                >
                  {item.label}
                </Menu.Checkbox>
              )
            }

            if (isCompositeItem(item)) {
              return (
                <Menu.Row
                  key={item.id}
                  label={item.label}
                  disabled={item.disabled}
                  className={OVERLAY_MENU_ROW_CLASSES}
                  onSelect={(): void => {
                    if (item.disabled !== true) {
                      dispatchAction(item.id)
                    }
                  }}
                >
                  <button
                    type="button"
                    disabled={item.disabled}
                    className={OVERLAY_MENU_COMPOSITE_PRIMARY_CLASSES}
                    onClick={(event): void => {
                      event.stopPropagation()
                      if (item.disabled !== true) {
                        dispatchAction(item.id)
                      }
                    }}
                  >
                    {item.icon === undefined ? null : (
                      <span
                        aria-hidden="true"
                        className={`material-symbols-outlined text-base leading-none ${
                          item.active === true
                            ? 'text-primary'
                            : 'text-on-surface-variant'
                        }`}
                      >
                        {item.icon}
                      </span>
                    )}
                    <span className="truncate">{item.label}</span>
                  </button>
                  <span className="flex shrink-0 items-center gap-1">
                    {item.actions.map((action) => (
                      <IconButton
                        key={action.id}
                        icon={action.icon ?? 'more_horiz'}
                        label={action.label}
                        size="sm"
                        variant="ghost"
                        pressed={action.pressed}
                        disabled={action.disabled}
                        showTooltip={TOOLTIP_SUPPRESSED}
                        className={overlayMenuActionButtonClass(
                          action.pressed === true
                        )}
                        onClick={(event): void => {
                          event.stopPropagation()
                          if (action.disabled !== true) {
                            dispatchAction(action.id)
                          }
                        }}
                      />
                    ))}
                  </span>
                </Menu.Row>
              )
            }

            return (
              <Menu.Row
                key={item.id}
                label={item.label}
                disabled={item.disabled}
                className={OVERLAY_MENU_ROW_CLASSES}
                onSelect={(): void => {
                  if (item.disabled !== true) {
                    dispatchAction(item.id)
                  }
                }}
              >
                <span className="flex items-center gap-2.5">
                  {item.icon === undefined ? null : (
                    <span
                      aria-hidden="true"
                      className="material-symbols-outlined text-base leading-none opacity-70"
                    >
                      {item.icon}
                    </span>
                  )}
                  <span>{item.label}</span>
                </span>
                {item.shortcut === undefined ? null : (
                  <kbd
                    className={OVERLAY_MENU_SHORTCUT_CLASSES}
                    aria-hidden="true"
                  >
                    {item.shortcut}
                  </kbd>
                )}
              </Menu.Row>
            )
          })}
        </Menu.Section>
      ))}
    </Menu.Context>
  )
}
