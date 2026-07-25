import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactElement,
} from 'react'
import { Menu } from '@/components/Menu'
import type { PaneLayoutId } from '../../../sessions/types'
import {
  BUILTIN_PANE_LAYOUT_REGISTRY,
  type LayoutShape,
} from '../../layout-registry'
import { builtInLayoutMenuItems } from './LayoutDisplayBuiltInLayouts'
import { customLayoutMenuItems } from './LayoutDisplayCustomLayouts'
import {
  layoutDisplayMenuModel,
  normalizeVisibleLayoutIds,
} from './LayoutDisplayMenu.shared'

export interface LayoutDisplayMenuProps {
  activeLayoutId: PaneLayoutId
  visibleLayoutIds: readonly PaneLayoutId[]
  blockedLayoutIds?: readonly PaneLayoutId[]
  hiddenCustomLayoutIds?: readonly PaneLayoutId[]
  layouts?: readonly LayoutShape[]
  onVisibleLayoutIdsChange: (next: readonly PaneLayoutId[]) => void
  onHiddenCustomLayoutIdsChange?: (next: readonly PaneLayoutId[]) => void
  onPickLayout?: (layoutId: PaneLayoutId) => boolean
  onCreateCustomLayout?: () => void
  onEditCustomLayout?: (layoutId: PaneLayoutId) => void
  onDuplicateCustomLayout?: (layoutId: PaneLayoutId) => void
  onDeleteCustomLayout?: (layoutId: PaneLayoutId) => void
  onOpenChange?: (open: boolean) => void
  nativeOverlay?: boolean
  compactSelectionMode?: boolean
}

type LayoutDisplayMenuTriggerProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label' | 'children' | 'type'
>

const LayoutDisplayMenuTriggerIcon = (): ReactElement => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M3 4.5H6.2M9.8 4.5H13M3 8H9.2M12.2 8H13M3 11.5H4.8M8.2 11.5H13"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
    />
    <circle cx="8" cy="4.5" r="1.6" stroke="currentColor" strokeWidth="1.25" />
    <circle
      cx="10.7"
      cy="8"
      r="1.45"
      stroke="currentColor"
      strokeWidth="1.25"
    />
    <circle
      cx="6.5"
      cy="11.5"
      r="1.55"
      stroke="currentColor"
      strokeWidth="1.25"
    />
  </svg>
)

const LayoutDisplayMenuTrigger = forwardRef<
  HTMLButtonElement,
  LayoutDisplayMenuTriggerProps
>(
  ({ className = '', ...buttonProps }, ref): ReactElement => (
    <button
      {...buttonProps}
      ref={ref}
      type="button"
      aria-label="Configure displayed layouts"
      className={`inline-flex h-5 w-6 items-center justify-center rounded text-on-surface-muted transition-colors hover:bg-primary/[0.08] hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${className}`}
    >
      <LayoutDisplayMenuTriggerIcon />
    </button>
  )
)

LayoutDisplayMenuTrigger.displayName = 'LayoutDisplayMenuTrigger'

export const LayoutDisplayMenu = ({
  activeLayoutId,
  visibleLayoutIds,
  blockedLayoutIds = [],
  hiddenCustomLayoutIds = [],
  layouts = BUILTIN_PANE_LAYOUT_REGISTRY.layouts,
  onVisibleLayoutIdsChange,
  onHiddenCustomLayoutIdsChange = undefined,
  onPickLayout = undefined,
  onCreateCustomLayout = undefined,
  onEditCustomLayout = undefined,
  onDuplicateCustomLayout = undefined,
  onDeleteCustomLayout = undefined,
  onOpenChange = undefined,
  nativeOverlay = false,
  compactSelectionMode = false,
}: LayoutDisplayMenuProps): ReactElement => {
  const [closeSignal, setCloseSignal] = useState(0)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menu = layoutDisplayMenuModel(layouts)

  const closeMenu = (): void => {
    triggerRef.current?.focus()
    setCloseSignal((signal) => signal + 1)
  }

  useEffect(() => {
    const normalized = normalizeVisibleLayoutIds(visibleLayoutIds, layouts)

    if (
      normalized.length !== visibleLayoutIds.length ||
      normalized.some((layoutId, index) => layoutId !== visibleLayoutIds[index])
    ) {
      onVisibleLayoutIdsChange(normalized)
    }
  }, [layouts, onVisibleLayoutIdsChange, visibleLayoutIds])

  return (
    <Menu
      placement="bottom-end"
      aria-label="Displayed layouts"
      onOpenChange={onOpenChange}
      tooltip="Configure displayed layouts"
      tooltipPlacement="bottom"
      closeSignal={closeSignal}
      nativeOverlay={nativeOverlay}
      trigger={<LayoutDisplayMenuTrigger ref={triggerRef} />}
    >
      <Menu.Section label="Displayed layouts">
        {builtInLayoutMenuItems({
          builtInLayouts: menu.builtInLayouts,
          allLayouts: layouts,
          activeLayoutId,
          blockedLayoutIds,
          visibleLayoutIds,
          onVisibleLayoutIdsChange,
          onPickLayout,
          onClose: closeMenu,
          compactSelectionMode,
        })}
      </Menu.Section>
      {menu.customLayouts.length > 0 && (
        <Menu.Section label="Custom">
          <div className="mx-1 my-1 h-px bg-outline-variant/25" />
          {customLayoutMenuItems({
            customLayouts: menu.customLayouts,
            activeLayoutId,
            blockedLayoutIds,
            hiddenCustomLayoutIds,
            onHiddenCustomLayoutIdsChange,
            onPickLayout,
            onEditCustomLayout,
            onDuplicateCustomLayout,
            onDeleteCustomLayout,
            closeMenu,
          })}
        </Menu.Section>
      )}
      {onCreateCustomLayout !== undefined && (
        <Menu.Section>
          <div className="mx-1 my-1 h-px bg-outline-variant/25" />
          <Menu.Item
            icon="dashboard_customize"
            onSelect={(): void => {
              closeMenu()
              onCreateCustomLayout()
            }}
          >
            Create custom layout
          </Menu.Item>
        </Menu.Section>
      )}
    </Menu>
  )
}
