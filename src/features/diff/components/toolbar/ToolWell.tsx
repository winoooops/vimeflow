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

// Disabled icon button used by the annotation placeholders. Uses aria-disabled
// (not native disabled) so the surrounding Tooltip can open on hover/focus
// while the button stays inert (no onClick handler).
interface WellDisabledButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: string
  label: string
}

const WellDisabledButton = forwardRef<
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
  onClick,
  disabled,
}: {
  icon: string
  label: string
  onClick: () => void
  disabled: boolean
}): ReactElement => (
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

// Extended tool-well: one tonal container holding an annotation group (add
// comment / highlight / eraser — all coming-soon placeholders, no backend yet)
// and a staging group (stage / unstage / discard / discard-all), separated by a
// felt divider. Rendered as a single unit so PriorityPlus overflows the whole
// well together rather than spilling individual buttons.
export const ToolWell = ({
  showUnstage,
  staging,
  onStage,
  onUnstage,
  onDiscard,
  discardAllSlot,
}: ToolWellProps): ReactElement => (
  <span className="inline-flex items-center gap-0.5 bg-surface-container-highest rounded-md px-0.5 py-px">
    {/* Annotation group — net-new, no backend yet. */}
    <ComingSoonTooltip label="Coming soon">
      <WellDisabledButton icon="add_comment" label="add comment" />
    </ComingSoonTooltip>
    <ComingSoonTooltip label="Coming soon">
      <WellDisabledButton
        icon="format_ink_highlighter"
        label="highlight selection"
      />
    </ComingSoonTooltip>
    <ComingSoonTooltip label="Coming soon">
      <WellDisabledButton icon="ink_eraser" label="clear markup" />
    </ComingSoonTooltip>

    <span
      aria-hidden="true"
      className="w-px h-[18px] bg-outline-variant/45 mx-[3px]"
    />

    {/* Staging group — fully wired when handlers are provided. */}
    {onStage !== undefined ? (
      <WellButton
        icon="add_box"
        label="stage"
        onClick={(): void => {
          void onStage()
        }}
        disabled={staging}
      />
    ) : (
      <ComingSoonTooltip label="Available in PR2">
        <WellDisabledButton icon="add_box" label="stage" />
      </ComingSoonTooltip>
    )}
    {showUnstage ? (
      onUnstage !== undefined ? (
        <WellButton
          icon="indeterminate_check_box"
          label="unstage"
          onClick={(): void => {
            void onUnstage()
          }}
          disabled={staging}
        />
      ) : (
        <ComingSoonTooltip label="Available in PR2">
          <WellDisabledButton icon="indeterminate_check_box" label="unstage" />
        </ComingSoonTooltip>
      )
    ) : null}
    {onDiscard !== undefined ? (
      <WellButton
        icon="backspace"
        label="discard"
        onClick={(): void => {
          void onDiscard()
        }}
        disabled={staging}
      />
    ) : (
      <ComingSoonTooltip label="Available in PR2">
        <WellDisabledButton icon="backspace" label="discard" />
      </ComingSoonTooltip>
    )}
    {discardAllSlot}
  </span>
)
