import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react'
import {
  FloatingFocusManager,
  FloatingPortal,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
  useListNavigation,
  useRole,
} from '@floating-ui/react'
import { formatShortcut, isMacPlatform } from '../../../lib/formatShortcut'

export interface TerminalContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number } | null
  onClose: () => void
  onCopy: () => void
  onPaste: () => void
  canCopy: boolean
}

const MENU_CLASSES =
  'z-50 min-w-52 rounded-md bg-surface-container-high/90 px-1 py-1 ' +
  'text-xs text-on-surface shadow-lg backdrop-blur-md backdrop-saturate-150 ' +
  'outline-none ring-0 focus:outline-none focus:ring-0'

const ITEM_CLASSES =
  'flex min-h-8 w-full items-center justify-between gap-6 rounded px-2 py-1.5 ' +
  'border-0 text-left outline-none ring-0 hover:bg-on-surface/10 ' +
  'focus:outline-none focus:ring-0 focus-visible:bg-on-surface/10 ' +
  'focus-visible:outline-none focus-visible:ring-0'

const DISABLED_ITEM_CLASSES =
  'aria-disabled:cursor-default aria-disabled:text-on-surface-variant/45 ' +
  'aria-disabled:hover:bg-transparent aria-disabled:focus:bg-transparent'

const SHORTCUT_CHIP_CLASSES =
  'shrink-0 rounded bg-on-surface/10 px-1.5 py-0.5 font-mono text-[10px] ' +
  'text-on-surface-variant'

const NON_MODAL_FOCUS = false
// Chips reflect the active platform's actual binding (see spec §4 table):
//   macOS:        Cmd+C copy / Cmd+Shift+V paste     → renders ⌘C / ⌘⇧V
//   Linux/Win:    Ctrl+Shift+C / Ctrl+Shift+V        → renders Ctrl+Shift+C / Ctrl+Shift+V
// Computed at module load — there's no live platform-flip use case.
const IS_MAC = isMacPlatform()

const COPY_SHORTCUT = formatShortcut(
  IS_MAC ? ['Mod', 'C'] : ['Ctrl', 'Shift', 'C']
)

const PASTE_SHORTCUT = formatShortcut(
  IS_MAC ? ['Mod', 'Shift', 'V'] : ['Ctrl', 'Shift', 'V']
)

export const TerminalContextMenu = ({
  isOpen,
  position,
  onClose,
  onCopy,
  onPaste,
  canCopy,
}: TerminalContextMenuProps): ReactElement | null => {
  const listRef = useRef<(HTMLElement | null)[]>([])
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const initialFocusIndex = canCopy ? 0 : 1

  const itemRefs = useMemo(
    () =>
      [0, 1].map((index) => (node: HTMLButtonElement | null): void => {
        listRef.current[index] = node
        if (node && isOpen && index === initialFocusIndex) {
          node.focus()
        }
      }),
    [initialFocusIndex, isOpen]
  )

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: (open): void => {
      if (!open) {
        onClose()
      }
    },
    placement: 'bottom-start',
    middleware: [
      offset(0),
      flip({ fallbackPlacements: ['top-start', 'bottom-end', 'top-end'] }),
      shift({ padding: 8 }),
    ],
  })

  useEffect(() => {
    if (!position) {
      return
    }

    refs.setReference({
      getBoundingClientRect: (): DOMRect => {
        const rect = {
          x: position.x,
          y: position.y,
          top: position.y,
          left: position.x,
          right: position.x,
          bottom: position.y,
          width: 0,
          height: 0,
        }

        return {
          ...rect,
          toJSON: (): typeof rect => rect,
        }
      },
    })
  }, [position, refs])

  useLayoutEffect(() => {
    if (!isOpen) {
      setActiveIndex(null)

      return
    }

    setActiveIndex(initialFocusIndex)
    listRef.current[initialFocusIndex]?.focus()
  }, [initialFocusIndex, isOpen])

  const disabledIndices = canCopy ? [] : [0]
  const role = useRole(context, { role: 'menu' })

  const dismiss = useDismiss(context, {
    outsidePress: true,
    escapeKey: true,
  })

  const listNavigation = useListNavigation(context, {
    listRef,
    activeIndex,
    onNavigate: setActiveIndex,
    loop: true,
    disabledIndices,
    openOnArrowKeyDown: false,
  })

  const { getFloatingProps, getItemProps } = useInteractions([
    role,
    dismiss,
    listNavigation,
  ])

  if (!isOpen) {
    return null
  }

  const handleCopyClick = (): void => {
    if (!canCopy) {
      return
    }

    onCopy()
    onClose()
  }

  const wrap = (handler: () => void) => (): void => {
    handler()
    onClose()
  }

  return (
    <FloatingPortal>
      <FloatingFocusManager
        context={context}
        initialFocus={-1}
        modal={NON_MODAL_FOCUS}
      >
        <div
          ref={refs.setFloating}
          style={floatingStyles}
          className={MENU_CLASSES}
          aria-label="Terminal actions"
          {...getFloatingProps()}
        >
          <button
            type="button"
            role="menuitem"
            ref={itemRefs[0]}
            {...getItemProps({
              onClick: handleCopyClick,
            })}
            tabIndex={activeIndex === 0 ? 0 : -1}
            className={`${ITEM_CLASSES} ${DISABLED_ITEM_CLASSES}`}
            aria-disabled={canCopy ? undefined : true}
          >
            <span>Copy</span>
            <kbd className={SHORTCUT_CHIP_CLASSES} aria-hidden="true">
              {COPY_SHORTCUT}
            </kbd>
          </button>
          <button
            type="button"
            aria-label="Paste"
            role="menuitem"
            ref={itemRefs[1]}
            {...getItemProps({
              onClick: wrap(onPaste),
            })}
            tabIndex={activeIndex === 1 ? 0 : -1}
            className={ITEM_CLASSES}
          >
            <span>Paste</span>
            <kbd className={SHORTCUT_CHIP_CLASSES} aria-hidden="true">
              {PASTE_SHORTCUT}
            </kbd>
          </button>
        </div>
      </FloatingFocusManager>
    </FloatingPortal>
  )
}
