import { useState, type ReactElement, type ReactNode } from 'react'
import { Chip } from '@/components/Chip'
import { Tooltip } from '@/components/Tooltip'
import { IconButton } from '@/components/IconButton'
import { Popover } from '@/components/Popover'
import { TOOLTIP_SUPPRESSED } from '@/lib/constants'
import { formatShortcut, type ShortcutInput } from '@/lib/formatShortcut'
import type { CommandId } from '@/features/keymap/catalog'
import {
  chordToAriaShortcut,
  chordToShortcutInput,
} from '@/features/keymap/displayKey'
import type { Keybindings } from '@/features/keymap/useKeybindings'
import { Menu } from '@/components/Menu'
import { PriorityPlus } from './PriorityPlus'
import { FilePill } from './FilePill'
import { ChangeStepper } from './ChangeStepper'
import {
  ToolWell,
  WellDisabledButton,
  WELL_DANGER_BUTTON_CLASSES,
  WELL_DISABLED_BUTTON_CLASSES,
} from './ToolWell'
import { ToolbarSeparator } from './ToolbarSeparator'

// Floating-UI popover confirmation for the Discard All action. Rendered as
// a floating box anchored to the trigger so it escapes any overflow clipping
// (same pattern as Dropdown). The two action buttons use native
// `type="button"` so they don't accidentally submit a parent form.
interface DiscardAllConfirmProps {
  fileName: string | undefined
  onConfirm: () => void
  onCancel: () => void
}

const DiscardAllConfirm = ({
  fileName,
  onConfirm,
  onCancel,
}: DiscardAllConfirmProps): ReactElement => {
  const label = fileName ? `"${fileName}"` : 'this file'

  return (
    <div className="p-3 space-y-3">
      <p className="text-xs text-on-surface leading-snug max-w-[17rem]">
        Discard all changes to {label}? This cannot be undone.
      </p>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-2.5 py-1 rounded-md text-xs text-on-surface-variant hover:bg-surface-container/60 transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="px-2.5 py-1 rounded-md text-xs bg-error/20 text-error hover:bg-error/30 transition-colors"
        >
          Discard
        </button>
      </div>
    </div>
  )
}

// Diff side the toolbar is rendering for. The `unstage` chip is only valid
// on the staged view (per spec Section 4.7); on the unstaged view it is
// omitted entirely rather than rendered disabled.
export type DiffMode = 'staged' | 'unstaged'

export interface DiffChipToolbarProps {
  bindingFor: Keybindings['bindingFor']
  // Which side of the diff this toolbar is bound to. Drives whether the
  // `unstage` chip renders (staged view only).
  diffMode: DiffMode
  onOpenSettings: () => void
  // Hunk navigation. `totalHunks` is optional — when omitted (or 0), the
  // stepper renders `0/0`. In PR1 prev/next are disabled placeholders;
  // PR3 wires the click handlers (the work was re-split: PR2 = staging,
  // PR3 = hunk navigation, PR4 = inline review).
  totalHunks?: number
  focusedHunkIndex?: number
  // File navigation — FUNCTIONAL in PR1 (frontend-only: stepping the
  // selection through the changed-files list, no Rust backend needed).
  // When `onPrevFile`/`onNextFile` are provided AND `totalFiles > 1` the
  // arrows are enabled; with `totalFiles <= 1` they render disabled (nowhere
  // to navigate) but WITHOUT a "coming soon" tooltip — they are simply inert.
  onPrevFile?: () => void
  onNextFile?: () => void
  // 0-based index of the selected file; -1 when nothing is selected. The
  // counter always renders the position as `currentFileIndex + 1 / totalFiles`.
  currentFileIndex: number
  totalFiles: number
  // Hunk navigation handlers — FUNCTIONAL in PR3. When provided the prev/next
  // hunk arrows become interactive; omitting them leaves them disabled. Both
  // must be provided together for the arrows to enable (mirrors the file-nav
  // pattern).
  onPrevHunk?: () => void
  onNextHunk?: () => void
  // Staging actions — FUNCTIONAL in PR2. When provided the staging buttons
  // become interactive; omitting them (or passing `staging === true`) leaves
  // the buttons disabled so pre-PR2 callers remain unaffected.
  onStage?: () => Promise<void>
  onUnstage?: () => Promise<void>
  onDiscard?: () => Promise<void>
  onDiscardAll?: () => Promise<void>
  // True while any staging IPC is in-flight — disables all staging buttons to
  // prevent double-fire while waiting for a round-trip.
  staging?: boolean
  // Filename shown in the Discard All confirmation popover ("Discard all
  // changes to <selectedFileName>?") and on the file pill. Optional — omit for
  // a generic prompt / em-dash placeholder.
  selectedFileName?: string
  // Feedback actions — inline review feedback. When `feedbackCount > 0` the
  // toolbar renders a pinned-right paired-action group: a muted "Discard"
  // button plus a primary-gradient "Finish (N)" button. At 0 neither renders.
  // The paired actions are pinned outside PriorityPlus and never overflow.
  // Optional (default 0 / no-op) so pre-feedback callers are unaffected,
  // mirroring the other optional-handler chips in this component.
  feedbackCount?: number
  onFinishFeedback?: () => void
  onDiscardFeedback?: () => void
  onRefreshActiveFile?: () => void
  // Request review (VIM-304) — delegate a code review of the active file to an
  // agent. Unlike Finish, this is ALWAYS available (not gated on pending
  // feedback): it opens the request-review popover. Omit to hide the button.
  onRequestReview?: () => void
}

// Composed chip toolbar. Pure controlled component — all state lives in the
// consumer. PriorityPlus measures the rendered chips and folds anything
// beyond the first row into a portal-rendered `…` menu (last items overflow
// first, so Settings drops before actionable controls).
//
// File navigation (FilePill) is FUNCTIONAL from PR1 — it only changes which
// file is selected, so no Rust backend is needed. Staging buttons (inside the
// ToolWell) are FUNCTIONAL in PR2 when the on* handlers are provided. The
// ChangeStepper hunk arrows are FUNCTIONAL in PR3 when onPrevHunk/onNextHunk
// are provided and there is more than one hunk. The pinned feedback actions
// render when feedbackCount > 0 (PR4 inline review).
export const DiffChipToolbar = ({
  bindingFor,
  diffMode,
  onOpenSettings,
  totalHunks = 0,
  focusedHunkIndex = 0,
  onPrevHunk = undefined,
  onNextHunk = undefined,
  onPrevFile = undefined,
  onNextFile = undefined,
  currentFileIndex,
  totalFiles,
  onStage = undefined,
  onUnstage = undefined,
  onDiscard = undefined,
  onDiscardAll = undefined,
  staging = false,
  selectedFileName = undefined,
  feedbackCount = 0,
  onFinishFeedback = undefined,
  onDiscardFeedback = undefined,
  onRefreshActiveFile = undefined,
  onRequestReview = undefined,
}: DiffChipToolbarProps): ReactElement => {
  const shortcutFor = (id: CommandId): ShortcutInput =>
    chordToShortcutInput(bindingFor(id))

  const ariaShortcutFor = (id: CommandId): string =>
    chordToAriaShortcut(bindingFor(id))

  const shortcutLabelFor = (id: CommandId): string =>
    formatShortcut(shortcutFor(id))

  // Discard All confirmation popover state. The trigger is the discard-all
  // button inside the tool-well; the confirm card renders on the shared Popover
  // anchored to that button.
  const [discardAllOpen, setDiscardAllOpen] = useState(false)

  const [discardAllAnchor, setDiscardAllAnchor] =
    useState<HTMLButtonElement | null>(null)

  const [toolbarAnchor, setToolbarAnchor] = useState<HTMLDivElement | null>(
    null
  )

  const discardAllPopoverAnchor =
    discardAllAnchor !== null && discardAllAnchor.offsetParent !== null
      ? discardAllAnchor
      : toolbarAnchor

  const openDiscardAllConfirmation = (): void => {
    if (!staging) {
      setDiscardAllOpen(true)
    }
  }

  const toggleDiscardAllConfirmation = (): void => {
    if (!staging) {
      setDiscardAllOpen((prev) => !prev)
    }
  }

  // Counter copy: `1/N` when there is at least one hunk, `0/0` otherwise.
  // Shows the current focused index as `focusedHunkIndex + 1` so the counter
  // is consistent with PR3 once prev/next start mutating the index.
  const hunkCounterText =
    totalHunks > 0 ? `${focusedHunkIndex + 1}/${totalHunks}` : '0/0'

  // File counter copy: clamp the transient "nothing selected yet" state to
  // `1/N` so users never see an invalid `0/N` position while auto-select is
  // catching up after a status refresh.
  const fileCounterPosition =
    totalFiles > 0 ? Math.min(Math.max(currentFileIndex + 1, 1), totalFiles) : 0
  const fileCounterText = `${fileCounterPosition}/${totalFiles}`

  // File arrows are functional only when both handlers are present AND there
  // is more than one file (no wrap-around on a single file). With <= 1 file
  // they render disabled but WITHOUT a tooltip — they are inert, not "coming
  // soon".
  const fileNavEnabled =
    onPrevFile !== undefined && onNextFile !== undefined && totalFiles > 1

  // Hunk arrows are functional when both handlers are present AND there is
  // more than one hunk to navigate. With <= 1 hunk they render disabled.
  const hunkNavEnabled =
    onPrevHunk !== undefined && onNextHunk !== undefined && totalHunks > 1

  // The discard-all button is rendered here (it owns the confirm popover +
  // floating refs) and slotted into the tool-well so it sits inside the same
  // tonal well as the other staging actions. FUNCTIONAL in PR2 when
  // onDiscardAll is provided; otherwise a coming-soon placeholder.
  //
  // Tooltip wraps the SPAN, not the button — the button owns the popover's
  // anchor ref, and Tooltip's cloneElement would clobber it. Disabled while
  // the popover is open so the two floating layers never co-exist.
  const discardAllSlot =
    onDiscardAll !== undefined ? (
      <Tooltip
        content="Discard all changes"
        shortcut={shortcutFor('diff-file-discard')}
        disabled={discardAllOpen}
      >
        <span>
          <IconButton
            ref={setDiscardAllAnchor}
            icon="delete_sweep"
            label="discard all"
            variant="danger"
            size="md"
            disabled={staging}
            aria-keyshortcuts={ariaShortcutFor('diff-file-discard')}
            aria-haspopup="dialog"
            aria-expanded={discardAllOpen}
            showTooltip={TOOLTIP_SUPPRESSED} // outer Tooltip already wraps the discard-all span
            className={
              staging
                ? WELL_DISABLED_BUTTON_CLASSES
                : WELL_DANGER_BUTTON_CLASSES
            }
            onClick={toggleDiscardAllConfirmation}
          />
          <Popover
            anchor={discardAllPopoverAnchor}
            open={discardAllOpen}
            onOpenChange={setDiscardAllOpen}
            placement="bottom-end"
            middleware={{ ancestorScroll: false }}
            aria-label="Discard all confirmation"
          >
            <DiscardAllConfirm
              fileName={selectedFileName}
              onConfirm={(): void => {
                setDiscardAllOpen(false)
                void onDiscardAll()
              }}
              onCancel={(): void => {
                setDiscardAllOpen(false)
              }}
            />
          </Popover>
        </span>
      </Tooltip>
    ) : (
      <Tooltip content="Available in PR2">
        <WellDisabledButton icon="delete_sweep" label="discard all" />
      </Tooltip>
    )

  // Build the chip list in priority order. Highest priority first → last to
  // overflow into the `…` menu when the toolbar is narrow.
  //
  // Each navigation/tool group is a single wrapping element so PriorityPlus
  // measures and overflows it as one unit (the whole file pill / change
  // stepper / tool-well collapses together, never spilling sub-buttons).
  //
  // Collapse order (lowest priority overflows FIRST):
  //   Settings → Change-stepper → Tool-well → File-pill
  // Group hairlines (ToolbarSeparator) sit between the major clusters and are
  // overflow-safe: PriorityPlus trims a trailing separator and drops them from
  // the `…` tray, so a hairline never dangles or appears in the menu.
  const chips: ReactNode[] = [
    // 1. file pill — lavender (primary) file-nav group (prev arrow + basename
    // pill + N/M badge + next arrow). FUNCTIONAL: steps the selection through
    // the changed-files list; inert on a single file.
    <FilePill
      key="file-nav"
      fileName={selectedFileName}
      counterText={fileCounterText}
      navEnabled={fileNavEnabled}
      onPrev={onPrevFile}
      onNext={onNextFile}
      previousShortcut={shortcutFor('diff-file-previous')}
      previousAriaKeyshortcuts={ariaShortcutFor('diff-file-previous')}
      nextShortcut={shortcutFor('diff-file-next')}
      nextAriaKeyshortcuts={ariaShortcutFor('diff-file-next')}
    />,
    // 2. tool-well — staging group (stage / unstage / discard / discard-all) as
    // a flat ghost-icon group (one unit).
    <ToolWell
      key="tool-well"
      showUnstage={diffMode === 'staged'}
      staging={staging}
      onStage={onStage}
      onUnstage={onUnstage}
      onDiscard={onDiscard}
      stageShortcut={shortcutFor('diff-hunk-stage')}
      stageAriaKeyshortcuts={ariaShortcutFor('diff-hunk-stage')}
      discardShortcut={shortcutFor('diff-hunk-discard')}
      discardAriaKeyshortcuts={ariaShortcutFor('diff-hunk-discard')}
      discardAllSlot={discardAllSlot}
    />,
    // 3. change stepper — azure (secondary) hunk-nav group (data_object glyph
    // + N/N + vertical up/down arrows). FUNCTIONAL in PR3.
    <ChangeStepper
      key="change-stepper"
      counterText={hunkCounterText}
      navEnabled={hunkNavEnabled}
      onPrev={onPrevHunk}
      onNext={onNextHunk}
      previousShortcut={shortcutFor('diff-hunk-previous')}
      previousAriaKeyshortcuts={ariaShortcutFor('diff-hunk-previous')}
      nextShortcut={shortcutFor('diff-hunk-next')}
      nextAriaKeyshortcuts={ariaShortcutFor('diff-hunk-next')}
    />,
    <ToolbarSeparator key="sep-settings" />,
    <IconButton
      key="settings"
      icon="settings"
      label="open hunk view settings"
      size="md"
      variant="ghost"
      onClick={onOpenSettings}
    />,
  ]

  // Paired feedback actions — pinned right, NEVER overflow (rendered outside
  // PriorityPlus). Only present when there is pending inline-review feedback.
  const showActions = feedbackCount > 0
  const canDiscardFeedback = onDiscardFeedback !== undefined
  const canFinishFeedback = onFinishFeedback !== undefined
  const canRequestReview = onRequestReview !== undefined

  const showPinnedActions =
    onRefreshActiveFile !== undefined || canRequestReview || showActions

  const renderNativeOverflowMenu = (
    hiddenKeys: readonly string[]
  ): ReactNode => {
    const hidden = new Set(hiddenKeys)
    const sections: ReactNode[] = []

    if (hidden.has('file-nav')) {
      sections.push(
        <Menu.Section key="file-nav" label={`File ${fileCounterText}`}>
          <Menu.Row
            label="Previous file"
            disabled={!fileNavEnabled}
            nativeOverlayIcon="chevron_left"
            onSelect={onPrevFile}
          >
            <span>Previous file</span>
            <kbd>{shortcutLabelFor('diff-file-previous')}</kbd>
          </Menu.Row>
          <Menu.Row
            label="Next file"
            disabled={!fileNavEnabled}
            nativeOverlayIcon="chevron_right"
            onSelect={onNextFile}
          >
            <span>Next file</span>
            <kbd>{shortcutLabelFor('diff-file-next')}</kbd>
          </Menu.Row>
        </Menu.Section>
      )
    }

    if (hidden.has('tool-well')) {
      sections.push(
        <Menu.Section key="tool-well" label="Changes">
          <Menu.Row
            label="Stage hunk"
            disabled={onStage === undefined || staging}
            nativeOverlayIcon="add_box"
            onSelect={(): Promise<void> | undefined => onStage?.()}
          >
            <span>Stage hunk</span>
            <kbd>{shortcutLabelFor('diff-hunk-stage')}</kbd>
          </Menu.Row>
          {diffMode === 'staged' ? (
            <Menu.Row
              label="Unstage"
              disabled={onUnstage === undefined || staging}
              nativeOverlayIcon="indeterminate_check_box"
              onSelect={(): Promise<void> | undefined => onUnstage?.()}
            >
              <span>Unstage</span>
              <kbd>{shortcutLabelFor('diff-hunk-stage')}</kbd>
            </Menu.Row>
          ) : null}
          <Menu.Row
            label="Discard hunk"
            disabled={onDiscard === undefined || staging}
            nativeOverlayIcon="backspace"
            onSelect={(): Promise<void> | undefined => onDiscard?.()}
          >
            <span>Discard hunk</span>
            <kbd>{shortcutLabelFor('diff-hunk-discard')}</kbd>
          </Menu.Row>
          {onDiscardAll !== undefined ? (
            <Menu.Row
              label="Discard all changes"
              disabled={staging}
              nativeOverlayIcon="delete_sweep"
              nativeOverlayDetail="Confirmation required"
              onSelect={openDiscardAllConfirmation}
            >
              <span>Discard all changes</span>
              <kbd>{shortcutLabelFor('diff-file-discard')}</kbd>
            </Menu.Row>
          ) : null}
        </Menu.Section>
      )
    }

    if (hidden.has('change-stepper')) {
      sections.push(
        <Menu.Section key="change-stepper" label={`Hunks ${hunkCounterText}`}>
          <Menu.Row
            label="Previous change"
            disabled={!hunkNavEnabled}
            nativeOverlayIcon="keyboard_arrow_up"
            onSelect={onPrevHunk}
          >
            <span>Previous change</span>
            <kbd>{shortcutLabelFor('diff-hunk-previous')}</kbd>
          </Menu.Row>
          <Menu.Row
            label="Next change"
            disabled={!hunkNavEnabled}
            nativeOverlayIcon="keyboard_arrow_down"
            onSelect={onNextHunk}
          >
            <span>Next change</span>
            <kbd>{shortcutLabelFor('diff-hunk-next')}</kbd>
          </Menu.Row>
        </Menu.Section>
      )
    }

    if (hidden.has('settings')) {
      sections.push(
        <Menu.Section key="settings" label="Settings">
          <Menu.Row
            label="Open hunk view settings"
            nativeOverlayIcon="settings"
            onSelect={onOpenSettings}
          >
            Open hunk view settings
          </Menu.Row>
        </Menu.Section>
      )
    }

    return sections.length === 0 ? null : sections
  }

  return (
    <div
      ref={setToolbarAnchor}
      role="toolbar"
      aria-label="Diff toolbar"
      className="flex min-h-[46px] items-center px-3 bg-surface-container-lowest border-b border-outline-variant/45"
    >
      <div className="flex w-full items-center">
        <PriorityPlus
          maxRows={1}
          remeasureKey={`${selectedFileName ?? ''}|${fileCounterText}|${hunkCounterText}|${diffMode}`}
          renderNativeOverflowMenu={renderNativeOverflowMenu}
        >
          {chips}
        </PriorityPlus>
        {showPinnedActions ? (
          <div className="ml-auto flex shrink-0 items-center gap-2 pl-3">
            {onRefreshActiveFile !== undefined ? (
              <Tooltip
                content="Refresh diff"
                shortcut={shortcutFor('diff-refresh')}
              >
                <button
                  type="button"
                  data-testid="diff-active-file-refresh"
                  aria-label="refresh diff"
                  aria-keyshortcuts={ariaShortcutFor('diff-refresh')}
                  onClick={onRefreshActiveFile}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md border border-outline-variant/60 bg-transparent px-3 font-mono text-[0.6875rem] font-medium text-on-surface transition-colors hover:border-primary/50 hover:bg-surface-container hover:text-primary disabled:cursor-default disabled:opacity-70 disabled:hover:border-outline-variant/60 disabled:hover:bg-transparent disabled:hover:text-on-surface"
                >
                  <span
                    aria-hidden="true"
                    className="material-symbols-outlined text-sm leading-none"
                  >
                    refresh
                  </span>
                  Refresh diff
                  <span
                    aria-hidden="true"
                    className="rounded border border-outline-variant/40 px-1 text-[0.625rem] leading-none text-on-surface-muted"
                  >
                    {shortcutLabelFor('diff-refresh')}
                  </span>
                </button>
              </Tooltip>
            ) : null}
            {canRequestReview ? (
              <Tooltip
                content="Request agent review"
                shortcut={shortcutFor('diff-review-request')}
              >
                <button
                  type="button"
                  data-testid="diff-request-review"
                  aria-label="request review"
                  aria-keyshortcuts={ariaShortcutFor('diff-review-request')}
                  onClick={onRequestReview}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md border border-outline-variant/60 bg-transparent px-3 font-mono text-[0.6875rem] font-medium text-on-surface transition-colors hover:border-primary/50 hover:bg-surface-container hover:text-primary"
                >
                  <span
                    aria-hidden="true"
                    className="material-symbols-outlined text-sm leading-none"
                  >
                    rate_review
                  </span>
                  Request review
                  <span
                    aria-hidden="true"
                    className="rounded border border-outline-variant/40 px-1 text-[0.625rem] leading-none text-on-surface-muted"
                  >
                    {shortcutLabelFor('diff-review-request')}
                  </span>
                </button>
              </Tooltip>
            ) : null}
            {showActions ? (
              <button
                type="button"
                aria-label="discard all feedback"
                disabled={!canDiscardFeedback}
                onClick={onDiscardFeedback}
                className="inline-flex items-center h-7 px-3.5 rounded-md font-mono text-[0.6875rem] font-medium bg-transparent border border-outline-variant/60 text-on-surface hover:bg-surface-container hover:border-error/50 hover:text-error transition-colors disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:border-outline-variant/60 disabled:hover:text-on-surface"
              >
                Discard
              </button>
            ) : null}
            {showActions ? (
              <button
                type="button"
                aria-label={`finish feedback (${feedbackCount})`}
                aria-keyshortcuts={ariaShortcutFor('diff-review-finish')}
                disabled={!canFinishFeedback}
                onClick={onFinishFeedback}
                className="inline-flex items-center gap-[7px] h-7 pl-[11px] pr-2 rounded-md font-mono text-[0.6875rem] font-bold text-on-primary bg-primary hover:bg-primary-container shadow-[0_1px_5px_color-mix(in_srgb,var(--color-primary)_40%,transparent)] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span
                  aria-hidden="true"
                  className="material-symbols-outlined text-sm leading-none"
                >
                  check
                </span>
                Finish ({shortcutLabelFor('diff-review-finish')})
                <Chip
                  tone="custom"
                  radius="pill"
                  size="custom"
                  className="rounded-full bg-on-primary/20 px-1.5 py-px font-mono text-[0.625rem] font-semibold text-on-primary"
                >
                  {feedbackCount}
                </Chip>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
