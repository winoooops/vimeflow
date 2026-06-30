import { type ReactElement } from 'react'
import { IconButton } from '@/components/IconButton'
import { Menu } from '@/components/Menu'
import type { PaneLayoutId } from '../../../sessions/types'
import { type LayoutShape } from '../../layout-registry'
import {
  customLayoutVisibilityLabel,
  deleteCustomLayoutLabel,
  duplicateCustomLayoutLabel,
  editCustomLayoutLabel,
  LayoutGlyphSlot,
  nextHiddenCustomLayoutIds,
  type LayoutDisplayNativeOverlayAction,
} from './LayoutDisplayMenu.shared'

const customDisplayCheckboxClass = (checked: boolean): string =>
  `inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] outline-none transition-colors focus-visible:ring-1 focus-visible:ring-primary ${
    checked
      ? 'bg-primary text-on-primary'
      : 'border border-on-surface-variant/30 bg-transparent text-on-surface-muted hover:border-primary/45 hover:text-primary'
  }`

const customLayoutRowClass = (blocked: boolean): string =>
  `flex min-h-8 items-center gap-1 rounded px-2 py-1 text-xs text-on-surface outline-none transition-colors focus-visible:bg-on-surface/10 ${
    blocked ? 'text-on-surface-variant/45' : 'hover:bg-on-surface/10'
  }`

interface CustomLayoutMenuActions {
  pickLayout: () => void
  editLayout: () => void
  duplicateLayout: () => void
  deleteLayout: () => void
  toggleVisibility: () => boolean
  toggleVisibilityAndClose: () => void
}

interface CustomLayoutMenuActionsOptions {
  layout: LayoutShape
  checked: boolean
  hiddenCustomLayoutIds: readonly PaneLayoutId[]
  onHiddenCustomLayoutIdsChange:
    | ((next: readonly PaneLayoutId[]) => void)
    | undefined
  onPickLayout: ((layoutId: PaneLayoutId) => boolean) | undefined
  onEditCustomLayout: ((layoutId: PaneLayoutId) => void) | undefined
  onDuplicateCustomLayout: ((layoutId: PaneLayoutId) => void) | undefined
  onDeleteCustomLayout: ((layoutId: PaneLayoutId) => void) | undefined
  closeMenu: () => void
}

const customLayoutMenuActions = ({
  layout,
  checked,
  hiddenCustomLayoutIds,
  onHiddenCustomLayoutIdsChange,
  onPickLayout,
  onEditCustomLayout,
  onDuplicateCustomLayout,
  onDeleteCustomLayout,
  closeMenu,
}: CustomLayoutMenuActionsOptions): CustomLayoutMenuActions => {
  const pickLayout = (): void => {
    if (onPickLayout?.(layout.id) === true) {
      closeMenu()
    }
  }

  const editLayout = (): void => {
    onEditCustomLayout?.(layout.id)
    closeMenu()
  }

  const duplicateLayout = (): void => {
    onDuplicateCustomLayout?.(layout.id)
    closeMenu()
  }

  const deleteLayout = (): void => {
    onDeleteCustomLayout?.(layout.id)
    closeMenu()
  }

  const toggleVisibility = (): boolean => {
    if (onHiddenCustomLayoutIdsChange === undefined) {
      return false
    }

    onHiddenCustomLayoutIdsChange(
      nextHiddenCustomLayoutIds(hiddenCustomLayoutIds, layout.id, checked)
    )

    return true
  }

  return {
    pickLayout,
    editLayout,
    duplicateLayout,
    deleteLayout,
    toggleVisibility,
    toggleVisibilityAndClose: (): void => {
      if (toggleVisibility()) {
        closeMenu()
      }
    },
  }
}

interface CustomLayoutNativeOverlayActionsOptions {
  layout: LayoutShape
  checked: boolean
  canToggleVisibility: boolean
  actions: CustomLayoutMenuActions
}

const customLayoutNativeOverlayActions = ({
  layout,
  checked,
  canToggleVisibility,
  actions,
}: CustomLayoutNativeOverlayActionsOptions): readonly LayoutDisplayNativeOverlayAction[] => [
  {
    label: editCustomLayoutLabel(layout),
    icon: 'edit',
    onSelect: actions.editLayout,
  },
  {
    label: duplicateCustomLayoutLabel(layout),
    icon: 'content_copy',
    onSelect: actions.duplicateLayout,
  },
  {
    label: deleteCustomLayoutLabel(layout),
    icon: 'delete',
    onSelect: actions.deleteLayout,
  },
  {
    label: customLayoutVisibilityLabel(layout, checked),
    icon: checked ? 'visibility' : 'visibility_off',
    pressed: checked,
    disabled: !canToggleVisibility,
    onSelect: actions.toggleVisibilityAndClose,
  },
]

interface CustomLayoutNativeOverlayPropsOptions extends CustomLayoutNativeOverlayActionsOptions {
  active: boolean
}

const customLayoutNativeOverlayProps = ({
  active,
  ...options
}: CustomLayoutNativeOverlayPropsOptions): {
  nativeOverlayIcon: string
  nativeOverlayActive: boolean
  nativeOverlayActions: readonly LayoutDisplayNativeOverlayAction[]
} => ({
  nativeOverlayIcon: 'dashboard',
  nativeOverlayActive: active,
  nativeOverlayActions: customLayoutNativeOverlayActions(options),
})

interface CustomLayoutPrimaryButtonProps {
  layout: LayoutShape
  blocked: boolean
  active: boolean
  onPick: () => void
}

const CustomLayoutPrimaryButton = ({
  layout,
  blocked,
  active,
  onPick,
}: CustomLayoutPrimaryButtonProps): ReactElement => (
  <button
    type="button"
    disabled={blocked}
    className="flex min-w-0 flex-1 items-center gap-2.5 rounded text-left outline-none focus-visible:ring-1 focus-visible:ring-primary"
    onClick={(event): void => {
      event.stopPropagation()
      onPick()
    }}
  >
    <LayoutGlyphSlot layout={layout} active={active} />
    <span className="truncate">{layout.name}</span>
  </button>
)

interface CustomLayoutActionButtonProps {
  icon: string
  label: string
  tone?: 'primary' | 'danger'
  onSelect: () => void
}

const CustomLayoutActionButton = ({
  icon,
  label,
  tone = 'primary',
  onSelect,
}: CustomLayoutActionButtonProps): ReactElement => (
  <IconButton
    icon={icon}
    label={label}
    size="sm"
    className={`h-5 w-5 text-on-surface-muted ${
      tone === 'danger' ? 'hover:text-error' : 'hover:text-primary'
    }`}
    onClick={(event): void => {
      event.stopPropagation()
      onSelect()
    }}
  />
)

interface CustomLayoutVisibilityToggleProps {
  checked: boolean
  label: string
  onToggle: () => void
}

const CustomLayoutVisibilityToggle = ({
  checked,
  label,
  onToggle,
}: CustomLayoutVisibilityToggleProps): ReactElement => (
  <button
    type="button"
    aria-label={label}
    aria-pressed={checked}
    className={customDisplayCheckboxClass(checked)}
    onClick={(event): void => {
      event.stopPropagation()
      onToggle()
    }}
  >
    {checked ? (
      <span
        aria-hidden="true"
        className="h-2 w-1.5 rotate-45 border-b-2 border-r-2 border-current"
      />
    ) : null}
  </button>
)

interface CustomLayoutRowContentProps {
  layout: LayoutShape
  blocked: boolean
  checked: boolean
  active: boolean
  actions: CustomLayoutMenuActions
}

const CustomLayoutRowContent = ({
  layout,
  blocked,
  checked,
  active,
  actions,
}: CustomLayoutRowContentProps): ReactElement => (
  <>
    <CustomLayoutPrimaryButton
      layout={layout}
      blocked={blocked}
      active={active}
      onPick={actions.pickLayout}
    />
    <CustomLayoutActionButton
      icon="edit"
      label={editCustomLayoutLabel(layout)}
      onSelect={actions.editLayout}
    />
    <CustomLayoutActionButton
      icon="content_copy"
      label={duplicateCustomLayoutLabel(layout)}
      onSelect={actions.duplicateLayout}
    />
    <CustomLayoutActionButton
      icon="delete"
      label={deleteCustomLayoutLabel(layout)}
      tone="danger"
      onSelect={actions.deleteLayout}
    />
    <CustomLayoutVisibilityToggle
      checked={checked}
      label={customLayoutVisibilityLabel(layout, checked)}
      onToggle={() => {
        actions.toggleVisibility()
      }}
    />
  </>
)

interface CustomLayoutMenuItemsOptions {
  customLayouts: readonly LayoutShape[]
  activeLayoutId: PaneLayoutId
  blockedLayoutIds: readonly PaneLayoutId[]
  hiddenCustomLayoutIds: readonly PaneLayoutId[]
  onHiddenCustomLayoutIdsChange:
    | ((next: readonly PaneLayoutId[]) => void)
    | undefined
  onPickLayout: ((layoutId: PaneLayoutId) => boolean) | undefined
  onEditCustomLayout: ((layoutId: PaneLayoutId) => void) | undefined
  onDuplicateCustomLayout: ((layoutId: PaneLayoutId) => void) | undefined
  onDeleteCustomLayout: ((layoutId: PaneLayoutId) => void) | undefined
  closeMenu: () => void
}

export const customLayoutMenuItems = ({
  customLayouts,
  activeLayoutId,
  blockedLayoutIds,
  hiddenCustomLayoutIds,
  onHiddenCustomLayoutIdsChange,
  onPickLayout,
  onEditCustomLayout,
  onDuplicateCustomLayout,
  onDeleteCustomLayout,
  closeMenu,
}: CustomLayoutMenuItemsOptions): ReactElement[] =>
  customLayouts.map((layout) => {
    const blocked = blockedLayoutIds.includes(layout.id)
    const checked = !hiddenCustomLayoutIds.includes(layout.id)
    const isActive = layout.id === activeLayoutId

    const actions = customLayoutMenuActions({
      layout,
      checked,
      hiddenCustomLayoutIds,
      onHiddenCustomLayoutIdsChange,
      onPickLayout,
      onEditCustomLayout,
      onDuplicateCustomLayout,
      onDeleteCustomLayout,
      closeMenu,
    })

    return (
      <Menu.Row
        key={layout.id}
        label={layout.name}
        disabled={blocked}
        className={customLayoutRowClass(blocked)}
        {...customLayoutNativeOverlayProps({
          layout,
          checked,
          active: isActive,
          canToggleVisibility: onHiddenCustomLayoutIdsChange !== undefined,
          actions,
        })}
        onSelect={actions.pickLayout}
      >
        <CustomLayoutRowContent
          layout={layout}
          blocked={blocked}
          checked={checked}
          active={isActive}
          actions={actions}
        />
      </Menu.Row>
    )
  })
