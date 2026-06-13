/* eslint-disable @typescript-eslint/no-restricted-imports -- hand-rolled popover predates the shared floating-surface primitive */
import { useState, type ReactElement, type ReactNode } from 'react'
import type { BaseDiffOptions, DiffsThemeNames } from '@pierre/diffs'
import {
  FloatingPortal,
  FloatingFocusManager,
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from '@floating-ui/react'
import { Tooltip } from '@/components/Tooltip'
import { Dropdown, type DropdownOption } from './Dropdown'
import { PriorityPlus } from './PriorityPlus'
import { Segmented } from './Segmented'
import { ViewSettingsDropdown } from './ViewSettingsDropdown'
import { FilePill } from './FilePill'
import { ChangeStepper } from './ChangeStepper'
import {
  ToolWell,
  WellDisabledButton,
  WELL_DANGER_BUTTON_CLASSES,
  WELL_DISABLED_BUTTON_CLASSES,
} from './ToolWell'

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

// Pierre option subtypes — pulled from `BaseDiffOptions` so a Pierre version
// bump that widens / renames the enums is caught at type-check time rather
// than producing a silent string-typed regression.
type DiffStyle = NonNullable<BaseDiffOptions['diffStyle']>
type DiffIndicators = NonNullable<BaseDiffOptions['diffIndicators']>
type Overflow = NonNullable<BaseDiffOptions['overflow']>
type LineDiffType = NonNullable<BaseDiffOptions['lineDiffType']>

// Diff side the toolbar is rendering for. The `unstage` chip is only valid
// on the staged view (per spec Section 4.7); on the unstaged view it is
// omitted entirely rather than rendered disabled.
export type DiffMode = 'staged' | 'unstaged'

// Restricted theme set explicitly listed in spec Section 4.6. Pierre's own
// `DiffsThemeNames` is a union with `(string & {})` so the actual values are
// not enumerable from the type alone — we surface the eight names the spec
// pins here so the dropdown has a finite, stable option list.
const THEME_OPTIONS: readonly DropdownOption<DiffsThemeNames>[] = [
  { value: 'pierre-dark', label: 'pierre-dark' },
  { value: 'pierre-dark-soft', label: 'pierre-dark-soft' },
  { value: 'pierre-light', label: 'pierre-light' },
  { value: 'pierre-light-soft', label: 'pierre-light-soft' },
  { value: 'catppuccin-mocha', label: 'catppuccin-mocha' },
  { value: 'dracula', label: 'dracula' },
  { value: 'github-dark', label: 'github-dark' },
  { value: 'one-dark-pro', label: 'one-dark-pro' },
]

const LINE_DIFF_OPTIONS: readonly DropdownOption<LineDiffType>[] = [
  {
    value: 'word-alt',
    label: 'Word-Alt',
    description: 'Highlight entire words with enhanced algorithm',
  },
  {
    value: 'word',
    label: 'Word',
    description: 'Highlight changed words within lines',
  },
  {
    value: 'char',
    label: 'Character',
    description: 'Highlight individual character changes',
  },
  {
    value: 'none',
    label: 'None',
    description: 'Show line-level changes only',
  },
]

export interface DiffChipToolbarProps {
  // Which side of the diff this toolbar is bound to. Drives whether the
  // `unstage` chip renders (staged view only).
  diffMode: DiffMode
  // Pierre options — controlled-component pairs so the consumer (DiffPanelContent
  // in Task 1.10) owns the state and drives both the toolbar chips and the
  // <MultiFileDiff options=...> render from the same values.
  diffStyle: DiffStyle
  onDiffStyleChange: (next: DiffStyle) => void
  theme: DiffsThemeNames
  onThemeChange: (next: DiffsThemeNames) => void
  lineDiffType: LineDiffType
  onLineDiffTypeChange: (next: LineDiffType) => void
  diffIndicators: DiffIndicators
  onDiffIndicatorsChange: (next: DiffIndicators) => void
  overflow: Overflow
  onOverflowChange: (next: Overflow) => void
  disableLineNumbers: boolean
  onDisableLineNumbersChange: (next: boolean) => void
  disableBackground: boolean
  onDisableBackgroundChange: (next: boolean) => void
  disableFileHeader: boolean
  onDisableFileHeaderChange: (next: boolean) => void
  stickyHeader: boolean
  onStickyHeaderChange: (next: boolean) => void
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
}

// Composed chip toolbar. Pure controlled component — all state lives in the
// consumer. PriorityPlus measures the rendered chips and folds anything
// beyond the first row into a portal-rendered `…` menu (last items overflow
// first, so the view dropdown drops before the theme dropdown, etc.).
//
// File navigation (FilePill) is FUNCTIONAL from PR1 — it only changes which
// file is selected, so no Rust backend is needed. Staging buttons (inside the
// ToolWell) are FUNCTIONAL in PR2 when the on* handlers are provided. The
// ChangeStepper hunk arrows are FUNCTIONAL in PR3 when onPrevHunk/onNextHunk
// are provided and there is more than one hunk. The pinned feedback actions
// render when feedbackCount > 0 (PR4 inline review).
export const DiffChipToolbar = ({
  diffMode,
  diffStyle,
  onDiffStyleChange,
  theme,
  onThemeChange,
  lineDiffType,
  onLineDiffTypeChange,
  diffIndicators,
  onDiffIndicatorsChange,
  overflow,
  onOverflowChange,
  disableLineNumbers,
  onDisableLineNumbersChange,
  disableBackground,
  onDisableBackgroundChange,
  disableFileHeader,
  onDisableFileHeaderChange,
  stickyHeader,
  onStickyHeaderChange,
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
}: DiffChipToolbarProps): ReactElement => {
  // Discard All confirmation popover state. The trigger is the discard-all
  // button inside the tool-well; the floating content is the DiscardAllConfirm
  // component rendered via FloatingPortal.
  const [discardAllOpen, setDiscardAllOpen] = useState(false)

  const {
    refs: discardAllRefs,
    floatingStyles: discardAllStyles,
    context: discardAllContext,
  } = useFloating({
    open: discardAllOpen,
    onOpenChange: setDiscardAllOpen,
    placement: 'bottom-end',
    middleware: [offset(4), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  })

  const discardAllDismiss = useDismiss(discardAllContext)
  const discardAllRole = useRole(discardAllContext, { role: 'dialog' })

  const {
    getReferenceProps: getDiscardAllReferenceProps,
    getFloatingProps: getDiscardAllFloatingProps,
  } = useInteractions([discardAllDismiss, discardAllRole])

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
  // floating ref, and Tooltip's cloneElement would clobber it. Disabled while
  // the popover is open so the two floating layers never co-exist.
  const discardAllSlot =
    onDiscardAll !== undefined ? (
      <Tooltip content="Discard all changes" disabled={discardAllOpen}>
        <span>
          <button
            ref={discardAllRefs.setReference}
            type="button"
            disabled={staging}
            aria-label="discard all"
            aria-expanded={discardAllOpen}
            className={
              staging
                ? WELL_DISABLED_BUTTON_CLASSES
                : WELL_DANGER_BUTTON_CLASSES
            }
            {...getDiscardAllReferenceProps({
              onClick: (): void => {
                if (!staging) {
                  setDiscardAllOpen((prev) => !prev)
                }
              },
            })}
          >
            <span
              aria-hidden="true"
              className="material-symbols-outlined text-base leading-none"
            >
              delete_sweep
            </span>
          </button>
          {discardAllOpen ? (
            <FloatingPortal>
              <FloatingFocusManager
                context={discardAllContext}
                initialFocus={-1}
              >
                <div
                  ref={discardAllRefs.setFloating}
                  style={discardAllStyles}
                  className="z-50 rounded-lg bg-surface-container-high/95 backdrop-blur-md backdrop-saturate-150 border border-outline-variant/20 shadow-xl"
                  {...getDiscardAllFloatingProps()}
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
                </div>
              </FloatingFocusManager>
            </FloatingPortal>
          ) : null}
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
  //   View → Theme → Hi-lite → Change-stepper → Tool-well → File-pill → Segmented
  const chips: ReactNode[] = [
    // 1. split / unified segmented — top priority; the most-used control.
    <Segmented
      key="diff-style"
      value={diffStyle}
      options={['split', 'unified'] as const}
      onChange={onDiffStyleChange}
    />,
    // 2. file pill — lavender (primary) file-nav group (prev arrow + basename
    // pill + N/M badge + next arrow). FUNCTIONAL: steps the selection through
    // the changed-files list; inert on a single file.
    <FilePill
      key="file-nav"
      fileName={selectedFileName}
      counterText={fileCounterText}
      navEnabled={fileNavEnabled}
      onPrev={onPrevFile}
      onNext={onNextFile}
    />,
    // 3. tool-well — annotation placeholders + staging group (one unit).
    <ToolWell
      key="tool-well"
      showUnstage={diffMode === 'staged'}
      staging={staging}
      onStage={onStage}
      onUnstage={onUnstage}
      onDiscard={onDiscard}
      discardAllSlot={discardAllSlot}
    />,
    // 4. change stepper — azure (secondary) hunk-nav group (data_object glyph
    // + N/N + vertical up/down arrows). FUNCTIONAL in PR3.
    <ChangeStepper
      key="change-stepper"
      counterText={hunkCounterText}
      navEnabled={hunkNavEnabled}
      onPrev={onPrevHunk}
      onNext={onNextHunk}
    />,
    // 5. highlight dropdown — `lineDiffType` Pierre option.
    <Dropdown
      key="highlight"
      label="highlight"
      value={lineDiffType}
      options={LINE_DIFF_OPTIONS}
      onChange={onLineDiffTypeChange}
      width={260}
    />,
    // 6. theme dropdown — `DiffsThemeNames` enumeration, with a palette lead
    // icon.
    <Dropdown
      key="theme"
      label="theme"
      value={theme}
      options={THEME_OPTIONS}
      onChange={onThemeChange}
      leadingIcon="palette"
    />,
    // 7. View ▾ gear chip — consolidates the indicators / overflow dropdowns
    // and the four boolean toggle chips into a single portal-rendered popover
    // (tune lead icon). Lowest priority → overflows first.
    <ViewSettingsDropdown
      key="view-settings"
      diffIndicators={diffIndicators}
      onDiffIndicatorsChange={onDiffIndicatorsChange}
      overflow={overflow}
      onOverflowChange={onOverflowChange}
      disableLineNumbers={disableLineNumbers}
      onDisableLineNumbersChange={onDisableLineNumbersChange}
      disableBackground={disableBackground}
      onDisableBackgroundChange={onDisableBackgroundChange}
      disableFileHeader={disableFileHeader}
      onDisableFileHeaderChange={onDisableFileHeaderChange}
      stickyHeader={stickyHeader}
      onStickyHeaderChange={onStickyHeaderChange}
    />,
  ]

  // Paired feedback actions — pinned right, NEVER overflow (rendered outside
  // PriorityPlus). Only present when there is pending inline-review feedback.
  const showActions = feedbackCount > 0
  const canDiscardFeedback = onDiscardFeedback !== undefined
  const canFinishFeedback = onFinishFeedback !== undefined

  return (
    <div
      role="toolbar"
      aria-label="Diff toolbar"
      className="px-3 py-2 rounded-lg bg-surface-container-low/[0.88] backdrop-blur-xl backdrop-saturate-150 border border-outline-variant/15"
    >
      <div className="flex w-full items-center">
        <PriorityPlus
          maxRows={1}
          remeasureKey={`${selectedFileName ?? ''}|${fileCounterText}|${hunkCounterText}|${theme}|${lineDiffType}|${diffMode}`}
        >
          {chips}
        </PriorityPlus>
        {showActions ? (
          <div className="ml-auto flex shrink-0 items-center gap-2 pl-3">
            <button
              type="button"
              aria-label="discard all feedback"
              disabled={!canDiscardFeedback}
              onClick={onDiscardFeedback}
              className="inline-flex items-center gap-[7px] h-[30px] px-3.5 rounded-md font-body text-[0.78rem] font-semibold bg-surface-container-highest text-on-surface-variant hover:bg-error/15 hover:text-error transition-colors disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-surface-container-highest disabled:hover:text-on-surface-variant"
            >
              Discard
            </button>
            <button
              type="button"
              aria-label={`finish feedback (${feedbackCount})`}
              disabled={!canFinishFeedback}
              onClick={onFinishFeedback}
              className="inline-flex items-center gap-[7px] h-[30px] px-3.5 rounded-md font-body text-[0.78rem] font-semibold text-on-primary bg-gradient-to-br from-primary to-primary-container shadow-[0_4px_14px_color-mix(in_srgb,var(--color-primary-container)_22%,transparent)] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span
                aria-hidden="true"
                className="material-symbols-outlined text-base leading-none"
              >
                check
              </span>
              Finish
              <span className="font-mono text-[0.625rem] font-semibold bg-on-primary/20 text-on-primary px-1.5 py-px rounded-full">
                {feedbackCount}
              </span>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
