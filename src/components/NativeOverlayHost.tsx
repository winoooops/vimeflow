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
  action: (request: {
    surfaceId: string
    actionId: string
    closeOnSelect?: boolean
    feedback?: 'copy'
  }) => Promise<unknown>
  close: (request: { surfaceId: string; reason: 'outside' }) => Promise<unknown>
  onRender: (callback: (payload: unknown) => void) => () => void
  onClear: (callback: () => void) => () => void
  onActionResult: (callback: (payload: unknown) => void) => () => void
}

const COPY_FEEDBACK_MS = 1300

const nativeOverlayHostBridge = (): NativeOverlayHostBridge | undefined =>
  window.vimeflow?.nativeOverlayHost

const isMenuRequest = (value: unknown): value is NativeOverlayRequest =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  (value as { kind?: unknown }).kind === 'menu' &&
  (value as { payload?: { kind?: unknown } }).payload?.kind === 'menu'

const isCopyActionResult = (
  value: unknown
): value is {
  surfaceId: string
  actionId: string
  feedback: 'copy'
  ok: boolean
} =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  typeof (value as { surfaceId?: unknown }).surfaceId === 'string' &&
  typeof (value as { actionId?: unknown }).actionId === 'string' &&
  (value as { feedback?: unknown }).feedback === 'copy' &&
  typeof (value as { ok?: unknown }).ok === 'boolean'

const OVERLAY_MENU_ROW_CLASSES =
  'group flex min-h-8 w-full items-center justify-between gap-6 rounded px-2.5 py-1.5 ' +
  'text-left text-xs text-on-surface outline-none ring-0 transition-colors ' +
  'hover:bg-on-surface/10 focus:outline-none focus-visible:bg-on-surface/10 ' +
  'aria-disabled:cursor-default aria-disabled:text-on-surface-variant/45 ' +
  'aria-disabled:hover:bg-transparent aria-disabled:focus:bg-transparent'

const OVERLAY_MENU_DETAIL_ROW_CLASSES =
  'group flex min-h-8 w-full items-center gap-2 rounded-chip px-[7px] py-1.5 ' +
  'text-left text-xs text-on-surface outline-none transition-colors ' +
  'hover:bg-primary-container/[0.12] focus:outline-none focus-visible:bg-primary-container/[0.12] ' +
  'aria-disabled:cursor-default aria-disabled:text-on-surface-variant/45 ' +
  'aria-disabled:hover:bg-transparent aria-disabled:focus:bg-transparent'

const OVERLAY_MENU_SHORTCUT_CLASSES =
  'shrink-0 rounded bg-on-surface/10 px-1.5 py-0.5 font-mono text-[10px] ' +
  'text-on-surface-variant'

const OVERLAY_MENU_ITEM_TEXT_CLASSES = 'flex min-w-0 flex-1 flex-col gap-px'

const OVERLAY_MENU_ITEM_LABEL_CLASSES = 'truncate'

const OVERLAY_MENU_ITEM_DETAIL_LABEL_CLASSES =
  'font-sans text-[8.5px] uppercase tracking-[0.09em] text-on-surface-muted'

const OVERLAY_MENU_ITEM_DETAIL_CLASSES =
  'truncate font-mono text-[11px] text-on-surface'

const OVERLAY_MENU_COPY_FEEDBACK_CLASSES =
  'inline-flex shrink-0 items-center gap-1 text-on-surface-muted transition-colors ' +
  'group-hover:text-on-surface-variant'

const OVERLAY_MENU_COPY_FEEDBACK_SUCCESS_CLASSES =
  'inline-flex shrink-0 items-center gap-1 text-success'

const OVERLAY_MENU_COPY_FEEDBACK_LABEL_CLASSES =
  'font-sans text-[10px] font-medium'

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

const overlayMenuRowClass = (item: NativeOverlayMenuItem): string =>
  'detail' in item && item.detail !== undefined
    ? OVERLAY_MENU_DETAIL_ROW_CLASSES
    : OVERLAY_MENU_ROW_CLASSES

const overlayMenuItemLabelClass = (item: NativeOverlayMenuItem): string =>
  'detail' in item && item.detail !== undefined
    ? OVERLAY_MENU_ITEM_DETAIL_LABEL_CLASSES
    : OVERLAY_MENU_ITEM_LABEL_CLASSES

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

const applyThemeSnapshot = (
  theme: NativeOverlayRequest['theme'] | undefined
): void => {
  if (theme === undefined) {
    return
  }

  const root = document.documentElement
  for (const [name, value] of Object.entries(theme.variables)) {
    root.style.setProperty(name, value)
  }

  if (theme.id === undefined) {
    delete root.dataset.theme
  } else {
    root.dataset.theme = theme.id
  }

  if (theme.colorScheme !== undefined) {
    root.style.colorScheme = theme.colorScheme
  }
}

export const NativeOverlayHost = (): ReactElement | null => {
  const [request, setRequest] = useState<NativeOverlayRequest | null>(null)
  const [copiedActionId, setCopiedActionId] = useState<string | null>(null)
  const requestRef = useRef<NativeOverlayRequest | null>(null)
  const copyFeedbackTimerRef = useRef<number | null>(null)
  requestRef.current = request

  const clearCopyFeedback = useCallback((): void => {
    if (copyFeedbackTimerRef.current !== null) {
      window.clearTimeout(copyFeedbackTimerRef.current)
      copyFeedbackTimerRef.current = null
    }

    setCopiedActionId(null)
  }, [])

  const showCopyFeedback = useCallback((actionId: string): void => {
    if (copyFeedbackTimerRef.current !== null) {
      window.clearTimeout(copyFeedbackTimerRef.current)
    }

    setCopiedActionId(actionId)
    copyFeedbackTimerRef.current = window.setTimeout(() => {
      copyFeedbackTimerRef.current = null
      setCopiedActionId(null)
    }, COPY_FEEDBACK_MS)
  }, [])

  useEffect(
    () => (): void => {
      if (copyFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyFeedbackTimerRef.current)
      }
    },
    []
  )

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
        applyThemeSnapshot(payload.theme)
        clearCopyFeedback()
        setRequest(payload)
      }
    })

    const cleanupClear = bridge.onClear(() => {
      clearCopyFeedback()
      setRequest(null)
    })

    const cleanupActionResult = bridge.onActionResult((payload) => {
      if (!isCopyActionResult(payload) || !payload.ok) {
        return
      }

      const current = requestRef.current
      if (current?.surfaceId !== payload.surfaceId) {
        return
      }

      showCopyFeedback(payload.actionId)
    })

    return (): void => {
      cleanupRender()
      cleanupClear()
      cleanupActionResult()
    }
  }, [clearCopyFeedback, showCopyFeedback])

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

    clearCopyFeedback()
    setRequest(null)
    void nativeOverlayHostBridge()?.close({
      surfaceId: current.surfaceId,
      reason: 'outside',
    })
  }, [clearCopyFeedback])

  if (request === null) {
    return null
  }

  const dispatchAction = (
    actionId: string,
    options: {
      closeOnSelect?: boolean
      feedback?: 'copy'
    } = {}
  ): void => {
    const closeOnSelect = options.closeOnSelect !== false

    if (closeOnSelect) {
      clearCopyFeedback()
      setRequest(null)
    }

    void nativeOverlayHostBridge()?.action({
      surfaceId: request.surfaceId,
      actionId,
      ...(closeOnSelect ? {} : { closeOnSelect: false }),
      ...(options.feedback === undefined ? {} : { feedback: options.feedback }),
    })
  }

  return (
    <Menu.Context
      position={request.anchorRect}
      placement={request.placement as Placement}
      matchAnchorWidth={request.payload.matchAnchorWidth === true}
      surfaceTone={request.payload.surfaceTone}
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

            const copyFeedback =
              item.feedback === 'copy' ? (
                <span
                  className={
                    copiedActionId === item.id
                      ? OVERLAY_MENU_COPY_FEEDBACK_SUCCESS_CLASSES
                      : OVERLAY_MENU_COPY_FEEDBACK_CLASSES
                  }
                  aria-live="polite"
                >
                  <span
                    aria-hidden="true"
                    className="material-symbols-outlined text-[15px] leading-none"
                  >
                    {copiedActionId === item.id ? 'check' : 'content_copy'}
                  </span>
                  {copiedActionId === item.id ? (
                    <span className={OVERLAY_MENU_COPY_FEEDBACK_LABEL_CLASSES}>
                      Copied
                    </span>
                  ) : null}
                </span>
              ) : null

            return (
              <Menu.Row
                key={item.id}
                label={item.label}
                disabled={item.disabled}
                className={overlayMenuRowClass(item)}
                onSelect={(): void => {
                  if (item.disabled !== true) {
                    dispatchAction(item.id, {
                      closeOnSelect: item.closeOnSelect,
                      feedback: item.feedback,
                    })
                  }
                }}
              >
                <span className="flex min-w-0 flex-1 items-center gap-2.5">
                  {item.icon === undefined ? null : (
                    <span
                      aria-hidden="true"
                      className="material-symbols-outlined shrink-0 text-base leading-none opacity-70"
                    >
                      {item.icon}
                    </span>
                  )}
                  <span className={OVERLAY_MENU_ITEM_TEXT_CLASSES}>
                    <span className={overlayMenuItemLabelClass(item)}>
                      {item.label}
                    </span>
                    {item.detail === undefined ? null : (
                      <span className={OVERLAY_MENU_ITEM_DETAIL_CLASSES}>
                        {item.detail}
                      </span>
                    )}
                  </span>
                </span>
                {copyFeedback ??
                  (item.shortcut === undefined ? null : (
                    <kbd
                      className={OVERLAY_MENU_SHORTCUT_CLASSES}
                      aria-hidden="true"
                    >
                      {item.shortcut}
                    </kbd>
                  ))}
              </Menu.Row>
            )
          })}
        </Menu.Section>
      ))}
    </Menu.Context>
  )
}
