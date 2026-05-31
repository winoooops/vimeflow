import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react'
import { Tooltip } from '../../../../components/Tooltip'

// Shared icon-button base for every button inside the tool-well (and the
// discard-all button the parent renders into the `discardAllSlot`, so the
// danger button visually belongs to the same well). Transparent resting
// surface; brighter on hover. Exported so the discard-all button matches.
export const WELL_BUTTON_CLASSES =
  'w-7 h-7 grid place-items-center rounded-md bg-transparent ' +
  'text-on-surface-variant hover:bg-surface-bright hover:text-on-surface ' +
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
    <button
      ref={ref}
      type="button"
      aria-disabled="true"
      aria-label={label}
      className={WELL_DISABLED_BUTTON_CLASSES}
      {...buttonProps}
    >
      <span
        aria-hidden="true"
        className="material-symbols-outlined text-base leading-none"
      >
        {icon}
      </span>
    </button>
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
  onClick,
  disabled,
}: {
  icon: string
  label: string
  tooltip: string
  onClick: () => void
  disabled: boolean
}): ReactElement => (
  <Tooltip content={tooltip}>
    <button
      type="button"
      disabled={disabled}
      aria-label={label}
      onClick={onClick}
      className={disabled ? WELL_DISABLED_BUTTON_CLASSES : WELL_BUTTON_CLASSES}
    >
      <span
        aria-hidden="true"
        className="material-symbols-outlined text-base leading-none"
      >
        {icon}
      </span>
    </button>
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
  // The discard-all button is rendered by the parent (it owns the confirm
  // popover + floating refs) and slotted in here so it sits inside the same
  // tonal well, after the felt divider.
  discardAllSlot: ReactNode
}

// Tool-well: one tonal container holding the per-file staging actions (stage /
// unstage / discard / discard-all), rendered as a single unit so PriorityPlus
// overflows the whole well together rather than spilling individual buttons.
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
  discardAllSlot,
}: ToolWellProps): ReactElement => (
  <span className="inline-flex items-center gap-0.5 bg-surface-container-highest rounded-md px-0.5 py-px">
    {/* Staging group — fully wired when handlers are provided. */}
    {onStage !== undefined ? (
      <WellButton
        icon="add_box"
        label="stage"
        tooltip="Stage hunk"
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
