import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react'
import { Tooltip } from '@/components/Tooltip'
import { IconButton } from '@/components/IconButton'
import { TOOLTIP_SUPPRESSED } from '@/lib/constants'
import type { ShortcutInput } from '@/lib/formatShortcut'

// Shared icon-button base for every button inside the tool-well (and the
// discard-all button the parent renders into the `discardAllSlot`, so the
// danger button visually belongs to the same well). Transparent resting
// surface; brighter on hover. Exported so the discard-all button matches.
export const WELL_BUTTON_CLASSES =
  'w-7 h-7 grid place-items-center rounded-md bg-transparent ' +
  'text-on-surface-variant hover:bg-surface-container hover:text-on-surface ' +
  'transition-colors'

// Disabled placeholder variant — muted, inert. Mirrors the not-allowed cursor
// + faded tone the rest of the toolbar uses for any not-yet-wired affordance.
export const WELL_DISABLED_BUTTON_CLASSES =
  'w-7 h-7 grid place-items-center rounded-md bg-transparent ' +
  'text-on-surface-variant/40 cursor-not-allowed transition-colors'

// Danger hover variant — the discard-all button tints red on hover. Exported so
// the parent (which owns the discard-all confirm popover + floating refs) can
// style its button identically to the in-well staging buttons.
export const WELL_DANGER_BUTTON_CLASSES =
  'w-7 h-7 grid place-items-center rounded-md bg-transparent ' +
  'text-on-surface-variant hover:bg-error/15 hover:text-error transition-colors'

// Wrap an aria-disabled placeholder in a "Coming soon" tooltip. Mirrors the
// ComingSoonTooltip used elsewhere; kept local so ToolWell is self-contained.
const ComingSoonTooltip = ({
  label,
  children,
}: {
  label: string
  children: ReactElement
}): ReactElement => <Tooltip content={label}>{children}</Tooltip>

// Disabled icon button used by the staging placeholders here, and shared with
// the discard-all placeholder in DiffChipToolbar (exported so the danger button
// reuses the same markup rather than a byte-identical copy). Uses aria-disabled
// (not native disabled) so the surrounding Tooltip can open on hover/focus
// while the button stays inert (no onClick handler).
interface WellDisabledButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: string
  label: string
}

export const WellDisabledButton = forwardRef<
  HTMLButtonElement,
  WellDisabledButtonProps
>(
  ({ icon, label, ...buttonProps }, ref): ReactElement => (
    <IconButton
      ref={ref}
      icon={icon}
      label={label}
      size="md"
      aria-disabled="true"
      showTooltip={TOOLTIP_SUPPRESSED} // explicit outer Tooltip owns the label
      className={WELL_DISABLED_BUTTON_CLASSES}
      {...buttonProps}
    />
  )
)

WellDisabledButton.displayName = 'WellDisabledButton'

// Enabled icon button — toggles between the active + disabled styling. Used by
// the functional staging buttons (stage / unstage / discard). `disabled` is
// driven by the single-flight `staging` flag from the parent.
const WellButton = ({
  icon,
  label,
  tooltip,
  shortcut,
  ariaKeyshortcuts,
  onClick,
  disabled,
}: {
  icon: string
  label: string
  tooltip: string
  shortcut: ShortcutInput
  ariaKeyshortcuts: string
  onClick: () => void
  disabled: boolean
}): ReactElement => (
  <Tooltip content={tooltip} shortcut={shortcut}>
    <IconButton
      icon={icon}
      label={label}
      size="md"
      disabled={disabled}
      aria-keyshortcuts={ariaKeyshortcuts}
      onClick={onClick}
      showTooltip={TOOLTIP_SUPPRESSED} // explicit outer Tooltip owns the label
      className={disabled ? WELL_DISABLED_BUTTON_CLASSES : WELL_BUTTON_CLASSES}
    />
  </Tooltip>
)

export interface ToolWellProps {
  // Whether the unstage button renders. Only valid on the staged view.
  showUnstage: boolean
  // Single-flight guard from the parent — disables all staging buttons while a
  // staging IPC round-trip is in flight.
  staging: boolean
  // Staging handlers. When a handler is undefined the corresponding button
  // renders as a "Available in PR2" coming-soon placeholder (pre-staging
  // callers stay unaffected), mirroring the original toolbar behavior.
  onStage: (() => Promise<void>) | undefined
  onUnstage: (() => Promise<void>) | undefined
  onDiscard: (() => Promise<void>) | undefined
  stageShortcut: ShortcutInput
  stageAriaKeyshortcuts: string
  discardShortcut: ShortcutInput
  discardAriaKeyshortcuts: string
  // The discard-all button is rendered by the parent (it owns the confirm
  // popover + floating refs) and slotted in here so it sits inside the same
  // tonal well, after the felt divider.
  discardAllSlot: ReactNode
}

// Tool-well: the per-file staging actions (stage / unstage / discard /
// discard-all) as a flat ghost-icon group — no tonal container block, so the
// buttons share the bar's quiet rhythm and only lift on hover. Rendered as a
// single inline-flex unit so PriorityPlus overflows the whole group together
// rather than spilling individual buttons.
//
// The speculative annotation tools (comment / highlight / erase) were dropped —
// commenting is the gutter `+` affordance, and highlight/erase had no backend
// or use case.
export const ToolWell = ({
  showUnstage,
  staging,
  onStage,
  onUnstage,
  onDiscard,
  stageShortcut,
  stageAriaKeyshortcuts,
  discardShortcut,
  discardAriaKeyshortcuts,
  discardAllSlot,
}: ToolWellProps): ReactElement => (
  <span className="inline-flex items-center gap-px">
    {/* Staging group — fully wired when handlers are provided. */}
    {onStage !== undefined ? (
      <WellButton
        icon="add_box"
        label="stage"
        tooltip="Stage hunk"
        shortcut={stageShortcut}
        ariaKeyshortcuts={stageAriaKeyshortcuts}
        onClick={(): void => {
          void onStage()
        }}
        disabled={staging}
      />
    ) : (
      <ComingSoonTooltip label="Stage — Available in PR2">
        <WellDisabledButton icon="add_box" label="stage" />
      </ComingSoonTooltip>
    )}
    {showUnstage ? (
      onUnstage !== undefined ? (
        <WellButton
          icon="indeterminate_check_box"
          label="unstage"
          tooltip="Unstage"
          shortcut={stageShortcut}
          ariaKeyshortcuts={stageAriaKeyshortcuts}
          onClick={(): void => {
            void onUnstage()
          }}
          disabled={staging}
        />
      ) : (
        <ComingSoonTooltip label="Unstage — Available in PR2">
          <WellDisabledButton icon="indeterminate_check_box" label="unstage" />
        </ComingSoonTooltip>
      )
    ) : null}
    {onDiscard !== undefined ? (
      <WellButton
        icon="backspace"
        label="discard"
        tooltip="Discard hunk"
        shortcut={discardShortcut}
        ariaKeyshortcuts={discardAriaKeyshortcuts}
        onClick={(): void => {
          void onDiscard()
        }}
        disabled={staging}
      />
    ) : (
      <ComingSoonTooltip label="Discard — Available in PR2">
        <WellDisabledButton icon="backspace" label="discard" />
      </ComingSoonTooltip>
    )}
    {discardAllSlot}
  </span>
)
