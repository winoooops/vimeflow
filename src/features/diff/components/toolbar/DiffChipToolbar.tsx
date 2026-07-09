import { useState, type ReactElement, type ReactNode } from 'react'
import type { BaseDiffOptions, DiffsThemeNames } from '@pierre/diffs'
import { Chip } from '@/components/Chip'
import { Tooltip } from '@/components/Tooltip'
import { IconButton } from '@/components/IconButton'
import { Popover } from '@/components/Popover'
import { TOOLTIP_SUPPRESSED } from '@/lib/constants'
import { Dropdown, type DropdownOption } from '@/components/Dropdown'
import { Menu } from '@/components/Menu'
import { PriorityPlus } from './PriorityPlus'
import { Segmented } from './Segmented'
import {
  ViewSettingsDropdown,
  VIEW_INDICATOR_OPTIONS,
  VIEW_OVERFLOW_OPTIONS,
} from './ViewSettingsDropdown'
import { FilePill } from './FilePill'
import { ChangeStepper } from './ChangeStepper'
import {
  ToolWell,
  WellDisabledButton,
  WELL_DANGER_BUTTON_CLASSES,
  WELL_DISABLED_BUTTON_CLASSES,
} from './ToolWell'
import { ToolbarSeparator } from './ToolbarSeparator'
import { CONFIG_CHIP_CLASSES, ConfigChipContent } from './ConfigChip'

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

const DIFF_STYLE_OPTIONS: readonly {
  value: DiffStyle
  label: string
  icon: string
}[] = [
  { value: 'split', label: 'Split', icon: 'vertical_split' },
  { value: 'unified', label: 'Unified', icon: 'view_headline' },
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
  onRefreshActiveFile?: () => void
  // Request review (VIM-304) — delegate a code review of the active file to an
  // agent. Unlike Finish, this is ALWAYS available (not gated on pending
  // feedback): it opens the request-review popover. Omit to hide the button.
  onRequestReview?: () => void
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
  onRefreshActiveFile = undefined,
  onRequestReview = undefined,
}: DiffChipToolbarProps): ReactElement => {
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
        shortcut="D"
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
  //   View → Theme → Hi-lite → Change-stepper → Tool-well → File-pill → Segmented
  // Group hairlines (ToolbarSeparator) sit between the major clusters and are
  // overflow-safe: PriorityPlus trims a trailing separator and drops them from
  // the `…` tray, so a hairline never dangles or appears in the menu.
  const chips: ReactNode[] = [
    // 1. split / unified segmented — top priority; the most-used control.
    <Segmented
      key="diff-style"
      value={diffStyle}
      options={['split', 'unified'] as const}
      onChange={onDiffStyleChange}
      icons={{ split: 'vertical_split', unified: 'view_headline' }}
      shortcuts={{ split: 't', unified: 't' }}
    />,
    // hairline between the view-mode control and the navigation cluster.
    <ToolbarSeparator key="sep-nav" />,
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
    // 3. tool-well — staging group (stage / unstage / discard / discard-all) as
    // a flat ghost-icon group (one unit).
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
    // hairline between the navigation cluster and the config chips.
    <ToolbarSeparator key="sep-config" />,
    // 5. highlight chip — `lineDiffType` Pierre option as a labelled config chip
    // (small-caps key + value inside the control).
    <Dropdown
      key="highlight"
      value={lineDiffType}
      options={LINE_DIFF_OPTIONS}
      onChange={onLineDiffTypeChange}
      width={260}
      renderTrigger={({ ref, props, current }): ReactElement => (
        <Tooltip content="Intra-line highlight granularity">
          <button
            ref={ref}
            type="button"
            className={CONFIG_CHIP_CLASSES}
            {...props}
          >
            <ConfigChipContent
              icon="format_ink_highlighter"
              label="Highlight"
              value={current?.label ?? lineDiffType}
            />
          </button>
        </Tooltip>
      )}
    />,
    // 6. theme chip — `DiffsThemeNames` enumeration, with a palette lead icon.
    <Dropdown
      key="theme"
      value={theme}
      options={THEME_OPTIONS}
      onChange={onThemeChange}
      renderTrigger={({ ref, props, current }): ReactElement => (
        <Tooltip content="Syntax theme">
          <button
            ref={ref}
            type="button"
            className={CONFIG_CHIP_CLASSES}
            {...props}
          >
            <ConfigChipContent
              icon="palette"
              label="Theme"
              value={current?.label ?? theme}
            />
          </button>
        </Tooltip>
      )}
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
  const canRequestReview = onRequestReview !== undefined

  const showPinnedActions =
    onRefreshActiveFile !== undefined || canRequestReview || showActions

  const renderNativeOverflowMenu = (
    hiddenKeys: readonly string[]
  ): ReactNode => {
    const hidden = new Set(hiddenKeys)
    const sections: ReactNode[] = []

    if (hidden.has('diff-style')) {
      sections.push(
        <Menu.Section key="diff-style" label="Diff view">
          {DIFF_STYLE_OPTIONS.map((option) => (
            <Menu.Checkbox
              key={option.value}
              icon={option.icon}
              checked={diffStyle === option.value}
              onChange={(): void => onDiffStyleChange(option.value)}
            >
              {option.label}
            </Menu.Checkbox>
          ))}
        </Menu.Section>
      )
    }

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
            <kbd>p</kbd>
          </Menu.Row>
          <Menu.Row
            label="Next file"
            disabled={!fileNavEnabled}
            nativeOverlayIcon="chevron_right"
            onSelect={onNextFile}
          >
            <span>Next file</span>
            <kbd>n</kbd>
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
            <kbd>s</kbd>
          </Menu.Row>
          {diffMode === 'staged' ? (
            <Menu.Row
              label="Unstage"
              disabled={onUnstage === undefined || staging}
              nativeOverlayIcon="indeterminate_check_box"
              onSelect={(): Promise<void> | undefined => onUnstage?.()}
            >
              <span>Unstage</span>
              <kbd>s</kbd>
            </Menu.Row>
          ) : null}
          <Menu.Row
            label="Discard hunk"
            disabled={onDiscard === undefined || staging}
            nativeOverlayIcon="backspace"
            onSelect={(): Promise<void> | undefined => onDiscard?.()}
          >
            <span>Discard hunk</span>
            <kbd>d</kbd>
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
            <kbd>[</kbd>
          </Menu.Row>
          <Menu.Row
            label="Next change"
            disabled={!hunkNavEnabled}
            nativeOverlayIcon="keyboard_arrow_down"
            onSelect={onNextHunk}
          >
            <span>Next change</span>
            <kbd>]</kbd>
          </Menu.Row>
        </Menu.Section>
      )
    }

    if (hidden.has('highlight')) {
      sections.push(
        <Menu.Section key="highlight" label="Highlight">
          {LINE_DIFF_OPTIONS.map((option) => (
            <Menu.Checkbox
              key={option.value}
              icon="format_ink_highlighter"
              checked={lineDiffType === option.value}
              onChange={(): void => onLineDiffTypeChange(option.value)}
            >
              {option.label}
            </Menu.Checkbox>
          ))}
        </Menu.Section>
      )
    }

    if (hidden.has('theme')) {
      sections.push(
        <Menu.Section key="theme" label="Theme">
          {THEME_OPTIONS.map((option) => (
            <Menu.Checkbox
              key={option.value}
              icon="palette"
              checked={theme === option.value}
              onChange={(): void => onThemeChange(option.value)}
            >
              {option.label}
            </Menu.Checkbox>
          ))}
        </Menu.Section>
      )
    }

    if (hidden.has('view-settings')) {
      sections.push(
        <Menu.Section key="view-format" label="Indicators">
          {VIEW_INDICATOR_OPTIONS.map((option) => (
            <Menu.Checkbox
              key={option.value}
              icon="flag"
              checked={diffIndicators === option.value}
              onChange={(): void => onDiffIndicatorsChange(option.value)}
            >
              {option.label}
            </Menu.Checkbox>
          ))}
        </Menu.Section>,
        <Menu.Section key="view-overflow" label="Overflow">
          {VIEW_OVERFLOW_OPTIONS.map((option) => (
            <Menu.Checkbox
              key={option.value}
              icon="wrap_text"
              checked={overflow === option.value}
              onChange={(): void => onOverflowChange(option.value)}
            >
              {option.label}
            </Menu.Checkbox>
          ))}
        </Menu.Section>,
        <Menu.Section key="view-options" label="View options">
          <Menu.Checkbox
            icon="123"
            checked={!disableLineNumbers}
            onChange={(next): void => onDisableLineNumbersChange(!next)}
          >
            Line numbers
          </Menu.Checkbox>
          <Menu.Checkbox
            icon="format_paint"
            checked={!disableBackground}
            onChange={(next): void => onDisableBackgroundChange(!next)}
          >
            Background tint
          </Menu.Checkbox>
          <Menu.Checkbox
            icon="description"
            checked={!disableFileHeader}
            onChange={(next): void => onDisableFileHeaderChange(!next)}
          >
            File header
          </Menu.Checkbox>
          <Menu.Checkbox
            icon="push_pin"
            checked={stickyHeader}
            onChange={onStickyHeaderChange}
          >
            Sticky header
          </Menu.Checkbox>
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
          remeasureKey={`${selectedFileName ?? ''}|${fileCounterText}|${hunkCounterText}|${theme}|${lineDiffType}|${diffMode}`}
          renderNativeOverflowMenu={renderNativeOverflowMenu}
        >
          {chips}
        </PriorityPlus>
        {showPinnedActions ? (
          <div className="ml-auto flex shrink-0 items-center gap-2 pl-3">
            {onRefreshActiveFile !== undefined ? (
              <Tooltip content="Refresh diff" shortcut="r">
                <button
                  type="button"
                  data-testid="diff-active-file-refresh"
                  aria-label="refresh diff"
                  aria-keyshortcuts="r"
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
                    r
                  </span>
                </button>
              </Tooltip>
            ) : null}
            {canRequestReview ? (
              <Tooltip content="Request agent review" shortcut="@">
                <button
                  type="button"
                  data-testid="diff-request-review"
                  aria-label="request review"
                  aria-keyshortcuts="@"
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
                    @
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
                aria-keyshortcuts="Y"
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
                Finish (Y)
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
