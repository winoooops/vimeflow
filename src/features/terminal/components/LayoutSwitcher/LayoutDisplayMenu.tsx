import { useEffect, useRef, useState, type ReactElement } from 'react'
import { IconButton } from '@/components/IconButton'
import { Menu } from '@/components/Menu'
import type { PaneLayoutId } from '../../../sessions/types'
import {
  BUILTIN_PANE_LAYOUT_REGISTRY,
  type LayoutShape,
} from '../../layout-registry'
import { LayoutGlyph } from './LayoutGlyph'

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
}

const LOCKED_DISPLAY_LAYOUT_IDS = new Set<PaneLayoutId>(['single'])

const isLockedDisplayLayout = (layoutId: PaneLayoutId): boolean =>
  LOCKED_DISPLAY_LAYOUT_IDS.has(layoutId)

const customDisplayCheckboxClass = (checked: boolean): string =>
  `inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] outline-none transition-colors focus-visible:ring-1 focus-visible:ring-primary ${
    checked
      ? 'bg-primary text-on-primary'
      : 'border border-on-surface-variant/30 bg-transparent text-on-surface-muted hover:border-primary/45 hover:text-primary'
  }`

const normalizeVisibleLayoutIds = (
  visibleLayoutIds: readonly PaneLayoutId[],
  layouts: readonly LayoutShape[]
): readonly PaneLayoutId[] =>
  layouts
    .filter((layout) => layout.definition.source === 'builtin')
    .map((layout) => layout.id)
    .filter(
      (layoutId) =>
        isLockedDisplayLayout(layoutId) || visibleLayoutIds.includes(layoutId)
    )

const buildNextVisibleLayoutIds = (
  visibleLayoutIds: readonly PaneLayoutId[],
  layoutId: PaneLayoutId,
  checked: boolean,
  layouts: readonly LayoutShape[]
): readonly PaneLayoutId[] => {
  const normalized = normalizeVisibleLayoutIds(visibleLayoutIds, layouts)

  return checked
    ? layouts
        .map((layout) => layout.id)
        .filter(
          (candidate) =>
            candidate === layoutId || normalized.includes(candidate)
        )
    : normalized.filter((candidate) => candidate !== layoutId)
}

interface LayoutDisplayNativeOverlayAction {
  label: string
  icon: string
  pressed?: boolean
  disabled?: boolean
  onSelect: () => void
}

interface CustomLayoutNativeOverlayActionsOptions {
  layout: LayoutShape
  checked: boolean
  hiddenCustomLayoutIds: readonly PaneLayoutId[]
  onHiddenCustomLayoutIdsChange:
    | ((next: readonly PaneLayoutId[]) => void)
    | undefined
  onEditCustomLayout: ((layoutId: PaneLayoutId) => void) | undefined
  onDuplicateCustomLayout: ((layoutId: PaneLayoutId) => void) | undefined
  onDeleteCustomLayout: ((layoutId: PaneLayoutId) => void) | undefined
  closeMenu: () => void
}

const customLayoutNativeOverlayActions = ({
  layout,
  checked,
  hiddenCustomLayoutIds,
  onHiddenCustomLayoutIdsChange,
  onEditCustomLayout,
  onDuplicateCustomLayout,
  onDeleteCustomLayout,
  closeMenu,
}: CustomLayoutNativeOverlayActionsOptions): readonly LayoutDisplayNativeOverlayAction[] => [
  {
    label: `Edit ${layout.name}`,
    icon: 'edit',
    onSelect: (): void => {
      onEditCustomLayout?.(layout.id)
      closeMenu()
    },
  },
  {
    label: `Duplicate ${layout.name}`,
    icon: 'content_copy',
    onSelect: (): void => {
      onDuplicateCustomLayout?.(layout.id)
      closeMenu()
    },
  },
  {
    label: `Delete ${layout.name}`,
    icon: 'delete',
    onSelect: (): void => {
      onDeleteCustomLayout?.(layout.id)
      closeMenu()
    },
  },
  {
    label: checked
      ? `Hide ${layout.name} from switcher`
      : `Show ${layout.name} in switcher`,
    icon: checked ? 'visibility' : 'visibility_off',
    pressed: checked,
    disabled: onHiddenCustomLayoutIdsChange === undefined,
    onSelect: (): void => {
      if (onHiddenCustomLayoutIdsChange === undefined) {
        return
      }

      onHiddenCustomLayoutIdsChange(
        checked
          ? [...hiddenCustomLayoutIds, layout.id]
          : hiddenCustomLayoutIds.filter((layoutId) => layoutId !== layout.id)
      )
      closeMenu()
    },
  },
]

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
}: LayoutDisplayMenuProps): ReactElement => {
  const [closeSignal, setCloseSignal] = useState(0)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

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
      trigger={
        <button
          ref={triggerRef}
          type="button"
          aria-label="Configure displayed layouts"
          className="inline-flex h-5 w-6 items-center justify-center rounded text-on-surface-muted transition-colors hover:bg-primary/[0.08] hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
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
            <circle
              cx="8"
              cy="4.5"
              r="1.6"
              stroke="currentColor"
              strokeWidth="1.25"
            />
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
        </button>
      }
    >
      <Menu.Section label="Displayed layouts">
        {layouts
          .filter((layout) => layout.definition.source === 'builtin')
          .map((layout) => {
            const layoutId = layout.id

            const checked =
              isLockedDisplayLayout(layoutId) ||
              visibleLayoutIds.includes(layoutId)
            const isActive = layoutId === activeLayoutId

            const disabled = isLockedDisplayLayout(layoutId) || isActive

            return (
              <Menu.Checkbox
                key={layoutId}
                checked={checked || isActive}
                disabled={disabled}
                onChange={(next): void =>
                  onVisibleLayoutIdsChange(
                    buildNextVisibleLayoutIds(
                      visibleLayoutIds,
                      layoutId,
                      next,
                      layouts
                    )
                  )
                }
              >
                <span className="flex items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-on-surface-variant"
                  >
                    <LayoutGlyph
                      layoutId={layoutId}
                      definition={layout.definition}
                    />
                  </span>
                  <span>{layout.name}</span>
                </span>
              </Menu.Checkbox>
            )
          })}
      </Menu.Section>
      {layouts.some((layout) => layout.definition.source === 'workspace') && (
        <Menu.Section label="Custom">
          <div className="mx-1 my-1 h-px bg-outline-variant/25" />
          {layouts
            .filter((layout) => layout.definition.source === 'workspace')
            .map((layout) => {
              const blocked = blockedLayoutIds.includes(layout.id)
              const checked = !hiddenCustomLayoutIds.includes(layout.id)
              const isActive = layout.id === activeLayoutId

              return (
                <Menu.Row
                  key={layout.id}
                  label={layout.name}
                  disabled={blocked}
                  className={`flex min-h-8 items-center gap-1 rounded px-2 py-1 text-xs text-on-surface outline-none transition-colors focus-visible:bg-on-surface/10 ${
                    blocked
                      ? 'text-on-surface-variant/45'
                      : 'hover:bg-on-surface/10'
                  }`}
                  nativeOverlayIcon="dashboard"
                  nativeOverlayActive={isActive}
                  nativeOverlayActions={customLayoutNativeOverlayActions({
                    layout,
                    checked,
                    hiddenCustomLayoutIds,
                    onHiddenCustomLayoutIdsChange,
                    onEditCustomLayout,
                    onDuplicateCustomLayout,
                    onDeleteCustomLayout,
                    closeMenu,
                  })}
                  onSelect={(): void => {
                    if (onPickLayout?.(layout.id) === true) {
                      closeMenu()
                    }
                  }}
                >
                  <button
                    type="button"
                    disabled={blocked}
                    className="flex min-w-0 flex-1 items-center gap-2.5 rounded text-left outline-none focus-visible:ring-1 focus-visible:ring-primary"
                    onClick={(event): void => {
                      event.stopPropagation()
                      if (onPickLayout?.(layout.id) === true) {
                        closeMenu()
                      }
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center ${
                        isActive ? 'text-primary' : 'text-on-surface-variant'
                      }`}
                    >
                      <LayoutGlyph
                        layoutId={layout.id}
                        definition={layout.definition}
                      />
                    </span>
                    <span className="truncate">{layout.name}</span>
                  </button>
                  <IconButton
                    icon="edit"
                    label={`Edit ${layout.name}`}
                    size="sm"
                    className="h-5 w-5 text-on-surface-muted hover:text-primary"
                    onClick={(event): void => {
                      event.stopPropagation()
                      onEditCustomLayout?.(layout.id)
                      closeMenu()
                    }}
                  />
                  <IconButton
                    icon="content_copy"
                    label={`Duplicate ${layout.name}`}
                    size="sm"
                    className="h-5 w-5 text-on-surface-muted hover:text-primary"
                    onClick={(event): void => {
                      event.stopPropagation()
                      onDuplicateCustomLayout?.(layout.id)
                      closeMenu()
                    }}
                  />
                  <IconButton
                    icon="delete"
                    label={`Delete ${layout.name}`}
                    size="sm"
                    className="h-5 w-5 text-on-surface-muted hover:text-error"
                    onClick={(event): void => {
                      event.stopPropagation()
                      onDeleteCustomLayout?.(layout.id)
                      closeMenu()
                    }}
                  />
                  <button
                    type="button"
                    aria-label={
                      checked
                        ? `Hide ${layout.name} from switcher`
                        : `Show ${layout.name} in switcher`
                    }
                    aria-pressed={checked}
                    className={customDisplayCheckboxClass(checked)}
                    onClick={(event): void => {
                      event.stopPropagation()
                      if (onHiddenCustomLayoutIdsChange === undefined) {
                        return
                      }

                      onHiddenCustomLayoutIdsChange(
                        checked
                          ? [...hiddenCustomLayoutIds, layout.id]
                          : hiddenCustomLayoutIds.filter(
                              (layoutId) => layoutId !== layout.id
                            )
                      )
                    }}
                  >
                    {checked && (
                      <span
                        aria-hidden="true"
                        className="h-2 w-1.5 rotate-45 border-b-2 border-r-2 border-current"
                      />
                    )}
                  </button>
                </Menu.Row>
              )
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
