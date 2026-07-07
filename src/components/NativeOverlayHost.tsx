import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from 'react'
import { IconButton } from '@/components/IconButton'
import { Menu } from '@/components/Menu'
import type {
  NativeOverlayDialogRequest,
  NativeOverlayMenuItem,
  NativeOverlayMenuRequest,
  NativeOverlayMenuSection,
  NativeOverlayCommandPaletteDialogPayload,
  NativeOverlayNewSessionCommandOption,
  NativeOverlayNewSessionDialogPayload,
  NativeOverlayRequest,
  NativeOverlayTooltipRequest,
} from '@/components/base/floating/nativeOverlay'
import type { Placement } from '@/components/base/floating/glassSurface'
import { TOOLTIP_SUPPRESSED } from '@/lib/constants'

interface NativeOverlayHostBridge {
  ready: (request: { surfaceId: string }) => Promise<unknown>
  action: (request: {
    surfaceId: string
    actionId: string
    closeOnSelect?: boolean
    suspendOnSelect?: boolean
    feedback?: 'copy'
    index?: number
  }) => Promise<unknown>
  close: (request: { surfaceId: string; reason: 'outside' }) => Promise<unknown>
  onRender: (callback: (payload: unknown) => void) => () => void
  onClear: (callback: () => void) => () => void
  onActionResult: (callback: (payload: unknown) => void) => () => void
  onKeyDown: (callback: (payload: unknown) => void) => () => void
}

interface NativeOverlayKeyboardEvent {
  surfaceId: string
  key: string
  code: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  repeat: boolean
}

type NativeOverlayNewSessionRequest = NativeOverlayDialogRequest & {
  payload: NativeOverlayNewSessionDialogPayload
}

type NativeOverlayCommandPaletteRequest = NativeOverlayDialogRequest & {
  payload: NativeOverlayCommandPaletteDialogPayload
}

const COPY_FEEDBACK_MS = 1300

const nativeOverlayHostBridge = (): NativeOverlayHostBridge | undefined =>
  window.vimeflow?.nativeOverlayHost

const isMenuRequest = (value: unknown): value is NativeOverlayMenuRequest =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  (value as { kind?: unknown }).kind === 'menu' &&
  (value as { payload?: { kind?: unknown } }).payload?.kind === 'menu'

const isTooltipRequest = (
  value: unknown
): value is NativeOverlayTooltipRequest =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  (value as { kind?: unknown }).kind === 'tooltip' &&
  (value as { payload?: { kind?: unknown; text?: unknown } }).payload?.kind ===
    'tooltip' &&
  typeof (value as { payload?: { text?: unknown } }).payload?.text === 'string'

const isDialogRequest = (value: unknown): value is NativeOverlayDialogRequest =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  (value as { kind?: unknown }).kind === 'dialog' &&
  (value as { payload?: { kind?: unknown; dialog?: unknown } }).payload
    ?.kind === 'dialog' &&
  ((value as { payload?: { dialog?: unknown } }).payload?.dialog ===
    'command-palette' ||
    (value as { payload?: { dialog?: unknown } }).payload?.dialog ===
      'new-session')

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

const isNativeOverlayKeyboardEvent = (
  value: unknown
): value is NativeOverlayKeyboardEvent =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  typeof (value as { surfaceId?: unknown }).surfaceId === 'string' &&
  typeof (value as { key?: unknown }).key === 'string' &&
  typeof (value as { code?: unknown }).code === 'string' &&
  typeof (value as { altKey?: unknown }).altKey === 'boolean' &&
  typeof (value as { ctrlKey?: unknown }).ctrlKey === 'boolean' &&
  typeof (value as { metaKey?: unknown }).metaKey === 'boolean' &&
  typeof (value as { shiftKey?: unknown }).shiftKey === 'boolean' &&
  typeof (value as { repeat?: unknown }).repeat === 'boolean'

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

const OVERLAY_TOOLTIP_CLASSES =
  'pointer-events-none rounded-md px-3 py-1.5 text-xs text-on-surface ' +
  'whitespace-nowrap shadow-lg bg-surface-container-high/90 backdrop-blur-md ' +
  'backdrop-saturate-150 border border-outline-variant/20'

const OVERLAY_DIALOG_BACKDROP_CLASSES =
  'fixed inset-0 flex items-start justify-center pt-[15vh] backdrop-blur-sm ' +
  'bg-scrim/40'

const OVERLAY_COMMAND_PALETTE_CLASSES =
  'w-full max-w-2xl mx-4 bg-surface-container/90 glass-panel rounded-2xl ' +
  'border border-outline-variant/30 shadow-2xl overflow-hidden'

const OVERLAY_COMMAND_PALETTE_INPUT_CLASSES =
  'relative w-full flex-1 bg-transparent border-none p-0 outline-none ' +
  'font-mono text-[13.5px] leading-[18px] placeholder:text-on-surface-muted'

const OVERLAY_COMMAND_PALETTE_ROW_CLASSES =
  'group flex items-center gap-[12px] px-[12px] py-[9px] my-[2px] ' +
  'rounded-[8px] border transition-colors cursor-pointer'

const OVERLAY_COMMAND_PALETTE_KEY_CLASSES =
  'inline-flex min-w-[16px] h-[16px] px-[4px] items-center justify-center ' +
  'rounded-[4px] border font-mono text-[9.5px] font-semibold'

const overlayCommandPaletteRowClass = (selected: boolean): string =>
  `${OVERLAY_COMMAND_PALETTE_ROW_CLASSES} ${
    selected
      ? 'bg-primary-container/10 border-primary-container/25'
      : 'border-transparent hover:bg-surface-container-high/40'
  }`

const overlayCommandPaletteKeyClass = (selected: boolean): string =>
  `${OVERLAY_COMMAND_PALETTE_KEY_CLASSES} ${
    selected
      ? 'bg-primary-container/[0.08] text-primary border-primary-container/40'
      : 'bg-surface-container-lowest/60 text-on-surface-muted border-outline-variant/40'
  }`

const OVERLAY_COMMAND_PALETTE_FOOTER_KEY_CLASSES =
  'inline-flex min-w-[18px] h-[18px] px-[5px] items-center justify-center ' +
  'rounded-[4px] border font-mono text-[10px] font-semibold ' +
  'bg-surface-container-highest/60 text-on-surface-variant border-outline-variant/60'

const OVERLAY_NEW_SESSION_PANEL_CLASSES =
  'w-[min(560px,calc(100vw-32px))] max-h-[min(680px,calc(100vh-48px))] ' +
  'flex flex-col overflow-hidden rounded-2xl border border-outline-variant/30 ' +
  'bg-surface-container-high/95 shadow-2xl backdrop-blur-md backdrop-saturate-150'

const OVERLAY_NEW_SESSION_LABEL_CLASSES =
  'text-[10.5px] font-semibold uppercase tracking-[0.08em] text-on-surface-muted'

const OVERLAY_NEW_SESSION_FIELD_CLASSES =
  'mt-2 flex h-11 min-w-0 items-center gap-2 rounded-[9px] ' +
  'bg-surface-container-lowest px-3 text-[13px] text-on-surface'

const OVERLAY_NEW_SESSION_LAYOUT_BUTTON_CLASSES =
  'flex w-full items-center justify-between gap-2 rounded-[8px] px-2 py-1.5 ' +
  'text-left text-[12px] transition-colors'

const OVERLAY_NEW_SESSION_PANE_BUTTON_CLASSES =
  'flex min-h-0 min-w-0 flex-col items-center justify-center gap-1.5 ' +
  'rounded-[10px] border border-dashed p-2 text-center transition-colors'

const OVERLAY_NEW_SESSION_COMMAND_BUTTON_CLASSES =
  'inline-flex items-center gap-1.5 rounded-[8px] border px-2 py-1 ' +
  'text-[11px] transition-colors'

const OVERLAY_NEW_SESSION_BROWSE_BUTTON_CLASSES =
  'h-11 cursor-pointer rounded-[9px] border border-outline-variant/45 px-3 ' +
  'text-[12px] text-on-surface-variant transition-colors ' +
  'hover:border-primary-container/50 hover:bg-primary-container/12 hover:text-on-surface ' +
  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary'

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

const resetThemeSnapshot = (root: HTMLElement): void => {
  for (const name of Array.from(root.style)) {
    if (name.startsWith('--color-') || name.startsWith('--shadow-')) {
      root.style.removeProperty(name)
    }
  }

  delete root.dataset.theme
  root.style.colorScheme = ''
}

const overlayMenuRowClass = (item: NativeOverlayMenuItem): string =>
  'detail' in item && item.detail !== undefined
    ? OVERLAY_MENU_DETAIL_ROW_CLASSES
    : OVERLAY_MENU_ROW_CLASSES

const overlayMenuItemLabelClass = (item: NativeOverlayMenuItem): string =>
  'detail' in item && item.detail !== undefined
    ? OVERLAY_MENU_ITEM_DETAIL_LABEL_CLASSES
    : OVERLAY_MENU_ITEM_LABEL_CLASSES

const sectionsForRequest = (
  request: NativeOverlayMenuRequest
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
  const root = document.documentElement
  resetThemeSnapshot(root)

  if (theme === undefined) {
    return
  }

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

const dispatchNativeOverlayKeyDown = (
  event: NativeOverlayKeyboardEvent
): void => {
  const target =
    document.activeElement instanceof HTMLElement &&
    document.activeElement !== document.body
      ? document.activeElement
      : (document.querySelector<HTMLElement>('[role="menu"]') ?? document.body)

  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: event.key,
      code: event.code,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      repeat: event.repeat,
      bubbles: true,
      cancelable: true,
    })
  )
}

const tooltipStyleForRequest = (
  request: NativeOverlayTooltipRequest
): CSSProperties => {
  const gap = 6
  const { x, y, width, height } = request.anchorRect
  const placement = request.placement

  const style: CSSProperties = {
    position: 'fixed',
    maxWidth: request.payload.maxWidth ?? 320,
  }

  if (placement.startsWith('bottom')) {
    return {
      ...style,
      left: x + width / 2,
      top: y + height + gap,
      transform: 'translateX(-50%)',
    }
  }

  if (placement.startsWith('left')) {
    return {
      ...style,
      left: x - gap,
      top: y + height / 2,
      transform: 'translate(-100%, -50%)',
    }
  }

  if (placement.startsWith('right')) {
    return {
      ...style,
      left: x + width + gap,
      top: y + height / 2,
      transform: 'translateY(-50%)',
    }
  }

  return {
    ...style,
    left: x + width / 2,
    top: y - gap,
    transform: 'translate(-50%, -100%)',
  }
}

const NativeOverlayCommandPalette = ({
  request,
  close,
}: {
  request: NativeOverlayCommandPaletteRequest
  close: () => void
}): ReactElement => {
  const rowRefs = useRef(new Map<string, HTMLDivElement>())
  const payload = request.payload
  const selectedIndex = payload.selectedIndex

  const selectedCommand =
    selectedIndex >= 0 && selectedIndex < payload.results.length
      ? payload.results[selectedIndex]
      : undefined

  const activeDescendantId =
    payload.activeDescendantId ??
    (selectedCommand === undefined
      ? undefined
      : `command-${selectedCommand.id}`)

  const showArgumentPlaceholder =
    payload.argumentPlaceholder !== undefined && payload.query.endsWith(' ')

  useEffect(() => {
    if (selectedCommand === undefined) {
      return
    }

    rowRefs.current
      .get(selectedCommand.id)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [selectedCommand])

  const setRowRef =
    (commandId: string) =>
    (node: HTMLDivElement | null): void => {
      if (node === null) {
        rowRefs.current.delete(commandId)

        return
      }

      rowRefs.current.set(commandId, node)
    }

  const dispatchAction = (
    actionId: string,
    options: { index?: number } = {}
  ): void => {
    void nativeOverlayHostBridge()?.action({
      surfaceId: request.surfaceId,
      actionId,
      closeOnSelect: false,
      ...options,
    })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={payload.ariaLabel}
      className={OVERLAY_DIALOG_BACKDROP_CLASSES}
      onMouseDown={(event): void => {
        if (event.target === event.currentTarget) {
          event.preventDefault()
          close()
        }
      }}
    >
      <div className={OVERLAY_COMMAND_PALETTE_CLASSES}>
        <div className="flex items-center gap-[10px] px-[16px] py-[14px]">
          <span
            aria-hidden="true"
            className="material-symbols-outlined text-[16px] text-primary-container"
          >
            terminal
          </span>
          <div className="relative flex-1 min-w-0">
            {showArgumentPlaceholder ? (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 flex items-center font-mono text-[13.5px] leading-[18px]"
              >
                <span className="whitespace-pre text-on-surface">
                  {payload.query}
                </span>
                <span className="text-on-surface-muted">
                  {payload.argumentPlaceholder}
                </span>
              </span>
            ) : null}
            <input
              type="text"
              value={payload.query}
              readOnly
              className={`${OVERLAY_COMMAND_PALETTE_INPUT_CLASSES} ${
                showArgumentPlaceholder
                  ? 'text-transparent caret-on-surface'
                  : 'text-on-surface'
              }`}
              placeholder="type a command, : prefix, or search files..."
              role="combobox"
              aria-label="Command palette search"
              aria-expanded
              aria-controls="command-palette-listbox"
              aria-activedescendant={activeDescendantId}
            />
          </div>
          <span className={OVERLAY_COMMAND_PALETTE_FOOTER_KEY_CLASSES}>
            ESC
          </span>
        </div>
        <div className="h-px bg-outline-variant/25" />
        <div
          id="command-palette-listbox"
          role="listbox"
          className="p-[6px] overflow-y-auto max-h-[60vh]"
        >
          {payload.results.map((command, index) => {
            const selected = index === selectedIndex

            return (
              <div
                key={command.id}
                ref={setRowRef(command.id)}
                id={`command-${command.id}`}
                role="option"
                aria-selected={selected}
                onMouseEnter={(): void => {
                  dispatchAction(payload.actions.selectIndex, { index })
                }}
                onMouseDown={(event): void => event.preventDefault()}
                onClick={(): void => {
                  dispatchAction(payload.actions.executeIndex, { index })
                }}
                className={overlayCommandPaletteRowClass(selected)}
              >
                <span
                  className={`material-symbols-outlined text-[15px] shrink-0 ${
                    selected ? 'text-primary' : 'text-on-surface-muted'
                  }`}
                  style={{
                    fontVariationSettings: selected ? '"FILL" 1' : '"FILL" 0',
                  }}
                >
                  {command.icon}
                </span>
                <span className="font-mono text-[11.5px] text-primary w-[120px] shrink-0 truncate">
                  {command.label}
                </span>
                <span className="text-[12.5px] text-on-surface flex-1 min-w-0 truncate">
                  {command.description}
                </span>
                {command.hint === undefined ? null : (
                  <span className="hidden text-[11px] text-on-surface-muted truncate sm:block">
                    {command.hint}
                  </span>
                )}
                {command.shortcut === undefined ||
                command.shortcut.length === 0 ? null : (
                  <div className="flex items-center gap-[3px] shrink-0">
                    {command.shortcut.map((key, keyIndex) => (
                      <span
                        key={`${command.id}:key:${String(keyIndex)}`}
                        className={overlayCommandPaletteKeyClass(selected)}
                      >
                        {key}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <div className="h-px bg-outline-variant/25" />
        <div className="flex items-center gap-[14px] px-[14px] py-[8px] bg-surface-container-lowest/50 font-mono text-[10px] text-on-surface-muted">
          <span className="flex items-center gap-[6px]">
            <span className={OVERLAY_COMMAND_PALETTE_FOOTER_KEY_CLASSES}>
              Enter
            </span>
            run
          </span>
          <span className="flex items-center gap-[6px]">
            <span className="flex gap-[3px]">
              <span className={OVERLAY_COMMAND_PALETTE_FOOTER_KEY_CLASSES}>
                Up
              </span>
              <span className={OVERLAY_COMMAND_PALETTE_FOOTER_KEY_CLASSES}>
                Down
              </span>
            </span>
            navigate
          </span>
        </div>
      </div>
    </div>
  )
}

const overlayCommandGlyph = (
  command: NativeOverlayNewSessionCommandOption,
  size = 15
): ReactElement => (
  <span
    aria-hidden="true"
    className="flex shrink-0 items-center justify-center rounded-lg font-mono leading-none"
    style={{
      width: size + 14,
      height: size + 14,
      color: `var(${command.accentVar})`,
      background: `color-mix(in srgb, var(${command.accentVar}) 16%, transparent)`,
      fontSize: size,
    }}
  >
    {command.materialIcon === undefined ? (
      (command.glyph ?? command.label.slice(0, 1))
    ) : (
      <span
        className="material-symbols-outlined leading-none"
        style={{ fontSize: size }}
      >
        {command.materialIcon}
      </span>
    )}
  </span>
)

const commandForId = (
  commands: readonly NativeOverlayNewSessionCommandOption[],
  commandId: string
): NativeOverlayNewSessionCommandOption =>
  commands.find((command) => command.id === commandId) ?? commands[0]

const layoutButtonClass = (selected: boolean): string =>
  `${OVERLAY_NEW_SESSION_LAYOUT_BUTTON_CLASSES} ${
    selected
      ? 'bg-primary-container/15 text-primary'
      : 'text-on-surface-variant hover:bg-surface-container-high/60'
  }`

const paneButtonClass = (selected: boolean): string =>
  `${OVERLAY_NEW_SESSION_PANE_BUTTON_CLASSES} ${
    selected
      ? 'border-primary-container/60 bg-primary-container/10'
      : 'border-outline-variant/50 bg-surface-container/40 hover:bg-surface-container/70'
  }`

const commandButtonClass = (selected: boolean): string =>
  `${OVERLAY_NEW_SESSION_COMMAND_BUTTON_CLASSES} ${
    selected
      ? 'border-primary-container/60 bg-primary-container/15 text-primary'
      : 'border-outline-variant/40 bg-surface-container-lowest/40 text-on-surface-variant hover:bg-surface-container-high/60'
  }`

const NativeOverlayNewSession = ({
  request,
  close,
}: {
  request: NativeOverlayNewSessionRequest
  close: () => void
}): ReactElement => {
  const payload = request.payload

  const selectedLayout =
    payload.layouts.find((layout) => layout.id === payload.selectedLayoutId) ??
    payload.layouts[0]

  const activePane =
    payload.panes.find(
      (pane) => pane.index === payload.activeCommandPaneIndex
    ) ?? payload.panes[0]

  const dispatchAction = (
    actionId: string,
    closeOnSelect = false,
    suspendOnSelect = false
  ): void => {
    void nativeOverlayHostBridge()?.action({
      surfaceId: request.surfaceId,
      actionId,
      closeOnSelect,
      ...(suspendOnSelect ? { suspendOnSelect: true } : {}),
    })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={payload.ariaLabel}
      className={OVERLAY_DIALOG_BACKDROP_CLASSES}
      onMouseDown={(event): void => {
        if (event.target === event.currentTarget) {
          event.preventDefault()
          close()
        }
      }}
    >
      <div className={OVERLAY_NEW_SESSION_PANEL_CLASSES}>
        <div className="flex items-center gap-2.5 px-5 pb-1 pt-3.5">
          <span
            className="material-symbols-outlined text-base text-primary-container"
            aria-hidden="true"
          >
            bolt
          </span>
          <span className="flex-1 text-[14.5px] font-semibold text-on-surface">
            New session
          </span>
          <IconButton
            icon="close"
            label="Close"
            onClick={(): void => dispatchAction(payload.actions.cancel, true)}
          />
        </div>

        <div className="min-h-0 overflow-auto px-5 pb-5 pt-2">
          <label className={OVERLAY_NEW_SESSION_LABEL_CLASSES}>
            Session name
          </label>
          <div className={OVERLAY_NEW_SESSION_FIELD_CLASSES}>
            <span
              className="material-symbols-outlined text-[15px] text-on-surface-muted"
              aria-hidden="true"
            >
              edit
            </span>
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left font-medium outline-none"
              onClick={(): void => dispatchAction(payload.actions.focusName)}
            >
              {payload.name}
            </button>
            {payload.nameEdited ? (
              <button
                type="button"
                className="rounded-full border border-primary-container/40 px-2 py-0.5 font-mono text-[9.5px] text-primary-container"
                onClick={(): void => dispatchAction(payload.actions.resetName)}
              >
                reset
              </button>
            ) : (
              <span className="rounded-full border border-outline-variant/50 px-2 py-0.5 font-mono text-[9.5px] text-on-surface-muted">
                folder name
              </span>
            )}
          </div>

          <div className={`${OVERLAY_NEW_SESSION_LABEL_CLASSES} mt-4`}>
            Working directory
          </div>
          <div className="mt-2 flex items-center gap-2">
            <div className={`${OVERLAY_NEW_SESSION_FIELD_CLASSES} mt-0 flex-1`}>
              <span
                className="material-symbols-outlined text-base text-primary-container"
                aria-hidden="true"
              >
                folder_open
              </span>
              <span className="min-w-0 truncate font-mono text-[12px]">
                {payload.path}
              </span>
            </div>
            <button
              type="button"
              className={OVERLAY_NEW_SESSION_BROWSE_BUTTON_CLASSES}
              onClick={(): void =>
                dispatchAction(payload.actions.browse, false, true)
              }
            >
              Browse
            </button>
          </div>

          <div className="mt-4 flex min-h-[232px] items-start gap-4">
            <div className="w-[158px] shrink-0">
              <div className={OVERLAY_NEW_SESSION_LABEL_CLASSES}>Layout</div>
              <div className="mt-2 max-h-[240px] overflow-auto pr-1">
                {payload.layouts.map((layout) => (
                  <button
                    key={layout.id}
                    type="button"
                    className={layoutButtonClass(
                      layout.id === payload.selectedLayoutId
                    )}
                    onClick={(): void =>
                      dispatchAction(
                        `${payload.actions.pickLayoutPrefix}${layout.id}`
                      )
                    }
                  >
                    <span className="truncate">{layout.label}</span>
                    <span className="font-mono text-[10px] text-on-surface-muted">
                      {layout.capacity}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="min-w-0 flex-1">
              <div className={OVERLAY_NEW_SESSION_LABEL_CLASSES}>
                Starting command
              </div>
              <div className="mt-0.5 text-[11px] text-on-surface-muted">
                choose a panel, then its starting command
              </div>
              <div className="mt-2.5 rounded-2xl border border-outline-variant/30 bg-surface-container-lowest/60 p-2 shadow-[inset_0_1px_0_color-mix(in_srgb,var(--color-on-surface)_8%,transparent)]">
                <div
                  className="grid h-[152px] gap-2"
                  style={{
                    gridTemplateColumns: selectedLayout.cols,
                    gridTemplateRows: selectedLayout.rows,
                    gridTemplateAreas: selectedLayout.areas
                      .map((row) => `"${row.join(' ')}"`)
                      .join(' '),
                  }}
                >
                  {payload.panes.map((pane) => {
                    const command = commandForId(
                      payload.commands,
                      pane.commandId
                    )

                    const selected =
                      pane.index === payload.activeCommandPaneIndex

                    return (
                      <button
                        key={pane.areaName}
                        type="button"
                        className={paneButtonClass(selected)}
                        style={{ gridArea: pane.areaName }}
                        onClick={(): void =>
                          dispatchAction(
                            `${payload.actions.selectPanePrefix}${String(
                              pane.index
                            )}`
                          )
                        }
                      >
                        {overlayCommandGlyph(command)}
                        <span className="max-w-full truncate text-xs font-semibold text-on-surface-variant">
                          {command.label}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5">
                {payload.commands.map((command) => (
                  <button
                    key={command.id}
                    type="button"
                    className={commandButtonClass(
                      command.id === activePane.commandId
                    )}
                    onClick={(): void =>
                      dispatchAction(
                        `${payload.actions.pickCommandPrefix}${String(
                          activePane.index
                        )}:${command.id}`
                      )
                    }
                  >
                    {overlayCommandGlyph(command, 12)}
                    <span>{command.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2.5 bg-surface-container-lowest/40 px-5 py-3.5">
          <button
            type="button"
            className="rounded-[9px] border border-outline-variant/35 px-3 py-2 text-[12px] text-on-surface-variant hover:bg-surface-container-high/60"
            onClick={(): void => dispatchAction(payload.actions.cancel, true)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-[9px] bg-primary px-3 py-2 text-[12px] font-semibold text-on-primary hover:bg-primary/90"
            onClick={(): void => dispatchAction(payload.actions.create, true)}
          >
            <span
              className="material-symbols-outlined text-[15px]"
              aria-hidden="true"
            >
              bolt
            </span>
            Create session
          </button>
        </div>
      </div>
    </div>
  )
}

export const NativeOverlayHost = ({
  mode = 'menu',
}: {
  mode?: 'menu' | 'tooltip'
}): ReactElement | null => {
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
      const isMenuLayerRequest =
        mode === 'menu' && (isMenuRequest(payload) || isDialogRequest(payload))

      if (isMenuLayerRequest) {
        applyThemeSnapshot(payload.theme)
        clearCopyFeedback()
        setRequest(payload)

        return
      }

      if (mode === 'tooltip' && isTooltipRequest(payload)) {
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

    const cleanupKeyDown = bridge.onKeyDown((payload) => {
      if (mode !== 'menu' || !isNativeOverlayKeyboardEvent(payload)) {
        return
      }

      const current = requestRef.current
      if (current?.surfaceId !== payload.surfaceId) {
        return
      }

      dispatchNativeOverlayKeyDown(payload)
    })

    return (): void => {
      cleanupRender()
      cleanupClear()
      cleanupActionResult()
      cleanupKeyDown()
    }
  }, [clearCopyFeedback, mode, showCopyFeedback])

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

  if (mode === 'tooltip') {
    if (!isTooltipRequest(request)) {
      return null
    }

    return (
      <div
        role="tooltip"
        className={OVERLAY_TOOLTIP_CLASSES}
        style={tooltipStyleForRequest(request)}
      >
        {request.payload.shortcut === undefined ? (
          request.payload.text
        ) : (
          <span className="flex items-center gap-3">
            <span className="min-w-0 flex-1">{request.payload.text}</span>
            <kbd
              data-testid="native-overlay-tooltip-shortcut"
              className={OVERLAY_MENU_SHORTCUT_CLASSES}
            >
              {request.payload.shortcut}
            </kbd>
          </span>
        )}
      </div>
    )
  }

  if (!isMenuRequest(request)) {
    if (isDialogRequest(request)) {
      if (request.payload.dialog === 'new-session') {
        return (
          <NativeOverlayNewSession
            request={request as NativeOverlayNewSessionRequest}
            close={close}
          />
        )
      }

      return (
        <NativeOverlayCommandPalette
          request={request as NativeOverlayCommandPaletteRequest}
          close={close}
        />
      )
    }

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
