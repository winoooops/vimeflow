import type { ReactElement, ReactNode } from 'react'
import type { BaseDiffOptions, DiffsThemeNames } from '@pierre/diffs'
import { Tooltip } from '../../../../components/Tooltip'
import { Dropdown, type DropdownOption } from './Dropdown'
import { PriorityPlus } from './PriorityPlus'
import { Segmented } from './Segmented'
import { ViewSettingsDropdown } from './ViewSettingsDropdown'

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
  // counter chip renders `0/0`. In PR1 prev/next are disabled placeholders;
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
}

// Styling shared by every icon-button chip — the staging chips, the prev/next
// hunk chips, and the counter. Disabled chips use a muted surface tone and the
// `not-allowed` cursor so it is obvious they are placeholders.
const DISABLED_ICON_CHIP_CLASSES =
  'inline-flex items-center justify-center w-8 h-8 rounded-md ' +
  'bg-surface-container/20 text-on-surface-variant/40 cursor-not-allowed ' +
  'transition-colors'

// Enabled icon-button chip — used by the FUNCTIONAL file-nav arrows. Slightly
// brighter surface + hover affordance so it reads as interactive, in contrast
// to the muted disabled placeholders.
const ICON_CHIP_CLASSES =
  'inline-flex items-center justify-center w-8 h-8 rounded-md ' +
  'bg-surface-container/40 text-on-surface-variant ' +
  'hover:bg-surface-container/70 hover:text-on-surface ' +
  'transition-colors'

// The counter chips are text chips — non-interactive, just a label. They carry
// a leading material icon (file `description` / hunk `data_object`) so the two
// `‹ N/M ›` arrow groups are distinguishable at a glance.
const COUNTER_CHIP_CLASSES =
  'inline-flex items-center justify-center gap-1 min-w-[3.25rem] h-8 px-2 ' +
  'rounded-md bg-surface-container/40 text-on-surface-variant text-[0.7rem] ' +
  'font-mono tracking-tight'

// Wrap a disabled chip in a "Available in PRx" tooltip so users know the
// placeholder will light up later. Centralized + parameterized so the copy
// stays consistent and re-scoping a milestone is a one-line change at the
// call site (staging chips → PR2, hunk-nav chips → PR3).
const ComingSoonTooltip = ({
  label,
  children,
}: {
  label: string
  children: ReactElement
}): ReactElement => <Tooltip content={label}>{children}</Tooltip>

// Small disabled icon button — the building block for prev hunk, next hunk,
// stage, unstage, discard, discard all. The `aria-label` carries the
// accessible name (the material icon span is decorative); the `disabled`
// attribute lets userEvent treat clicks as no-ops and lets assistive tech
// surface the unavailable state.
const DisabledIconChip = ({
  icon,
  label,
}: {
  icon: string
  label: string
}): ReactElement => (
  <button
    type="button"
    disabled
    aria-label={label}
    className={DISABLED_ICON_CHIP_CLASSES}
  >
    <span
      aria-hidden="true"
      className="material-symbols-outlined text-base leading-none"
    >
      {icon}
    </span>
  </button>
)

// Icon button that toggles between the enabled + disabled styling based on
// `disabled`. Used by the functional file-nav arrows: enabled when there is
// more than one file to step through, disabled (inert, no tooltip) on a single
// file. When disabled it reuses the placeholder styling for visual consistency
// with the not-yet-wired chips.
const IconChip = ({
  icon,
  label,
  onClick = undefined,
  disabled = false,
}: {
  icon: string
  label: string
  onClick?: () => void
  disabled?: boolean
}): ReactElement => (
  <button
    type="button"
    disabled={disabled}
    aria-label={label}
    onClick={onClick}
    className={disabled ? DISABLED_ICON_CHIP_CLASSES : ICON_CHIP_CLASSES}
  >
    <span
      aria-hidden="true"
      className="material-symbols-outlined text-base leading-none"
    >
      {icon}
    </span>
  </button>
)

// Text counter chip with a leading material icon. `icon` distinguishes the two
// `‹ N/M ›` groups: `description` (file) vs `data_object` (hunk). The icon is
// decorative — the `aria-label` (passed by the caller) carries the accessible
// position string.
const CounterChip = ({
  icon,
  label,
  text,
}: {
  icon: string
  label: string
  text: string
}): ReactElement => (
  <span aria-label={label} className={COUNTER_CHIP_CLASSES}>
    <span
      aria-hidden="true"
      className="material-symbols-outlined text-sm leading-none"
    >
      {icon}
    </span>
    {text}
  </span>
)

// Composed chip toolbar. Pure controlled component — all state lives in the
// consumer. PriorityPlus measures the rendered chips and folds anything
// beyond the first row into a portal-rendered `…` menu (last items overflow
// first, so toggles drop before dropdowns drop before navigation chips).
//
// File navigation (prev-file / counter / next-file) is FUNCTIONAL from PR1 —
// it only changes which file is selected, so no Rust backend is needed. The
// staging chips (stage / unstage / discard / discard all) and the hunk
// prev/next/counter chips still render disabled, keeping the UI shape visually
// complete even though their IPC ships later. Disabled-chip tooltips read
// "Available in PR2" (staging) / "Available in PR3" (hunk navigation).
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
  onPrevFile = undefined,
  onNextFile = undefined,
  currentFileIndex,
  totalFiles,
}: DiffChipToolbarProps): ReactElement => {
  // Counter copy: `1/N` when there is at least one hunk, `0/0` otherwise.
  // PR1 shows the current focused index as `focusedHunkIndex + 1` so the
  // counter is consistent with PR3 once prev/next start mutating the index.
  const hunkCounterText =
    totalHunks > 0 ? `${focusedHunkIndex + 1}/${totalHunks}` : '0/0'

  // File counter copy: `1/N` when a file is selected, `0/N` when nothing is
  // selected (currentFileIndex === -1). The counter always reflects the
  // position even on a single file (where the arrows are inert).
  const fileCounterText = `${currentFileIndex + 1}/${totalFiles}`

  // File arrows are functional only when both handlers are present AND there
  // is more than one file (no wrap-around on a single file). With <= 1 file
  // they render disabled but WITHOUT a tooltip — they are inert, not "coming
  // soon".
  const fileNavEnabled =
    onPrevFile !== undefined && onNextFile !== undefined && totalFiles > 1

  // Build the chip list in priority order. Highest priority first → last to
  // overflow into the `…` menu when the toolbar is narrow.
  //
  // The chip array is declared inline (rather than memoized) because every
  // chip is a thin wrapper around primitives that already memoize their own
  // children when needed. PriorityPlus measures the rendered DOM on resize,
  // not the JSX, so churning the array on each render is cheap.
  const chips: ReactNode[] = [
    // 1. split / unified segmented — top priority; the most-used control.
    <Segmented
      key="diff-style"
      value={diffStyle}
      options={['split', 'unified'] as const}
      onChange={onDiffStyleChange}
    />,
    // 2. prev file — FUNCTIONAL: steps the selection to the previous changed
    // file (wrap-around handled by the consumer). Disabled + inert on a single
    // file; no tooltip in either state.
    <IconChip
      key="prev-file"
      icon="chevron_left"
      label="previous file"
      onClick={onPrevFile}
      disabled={!fileNavEnabled}
    />,
    // 3. file N/M counter — `description` icon distinguishes it from the hunk
    // counter. Always shows the position (`currentFileIndex + 1 / totalFiles`).
    <CounterChip
      key="file-counter"
      icon="description"
      label={`file ${fileCounterText}`}
      text={fileCounterText}
    />,
    // 4. next file — FUNCTIONAL counterpart to prev file.
    <IconChip
      key="next-file"
      icon="chevron_right"
      label="next file"
      onClick={onNextFile}
      disabled={!fileNavEnabled}
    />,
    // 5. prev hunk — disabled placeholder in PR1; PR3 wires the click.
    <ComingSoonTooltip key="prev-hunk" label="Available in PR3">
      <DisabledIconChip icon="chevron_left" label="prev hunk" />
    </ComingSoonTooltip>,
    // 6. hunk N/M counter — text chip with the `data_object` icon (code/hunks)
    // so it reads distinctly from the file counter. Reads `1/totalHunks` until
    // PR3 starts mutating the focus index.
    <CounterChip
      key="hunk-counter"
      icon="data_object"
      label={`hunk ${hunkCounterText}`}
      text={hunkCounterText}
    />,
    // 7. next hunk — disabled placeholder in PR1; PR3 wires the click.
    <ComingSoonTooltip key="next-hunk" label="Available in PR3">
      <DisabledIconChip icon="chevron_right" label="next hunk" />
    </ComingSoonTooltip>,
    // 8. stage — disabled placeholder; staging ships in PR2.
    <ComingSoonTooltip key="stage" label="Available in PR2">
      <DisabledIconChip icon="add_box" label="stage" />
    </ComingSoonTooltip>,
    // 9. unstage — only rendered on the staged diff view. On unstaged diffs
    // the chip is omitted entirely (per spec Section 4.7) because the
    // operation is meaningless there. Staging ships in PR2.
    ...(diffMode === 'staged'
      ? [
          <ComingSoonTooltip key="unstage" label="Available in PR2">
            <DisabledIconChip icon="indeterminate_check_box" label="unstage" />
          </ComingSoonTooltip>,
        ]
      : []),
    // 10. discard — disabled placeholder; staging ships in PR2.
    <ComingSoonTooltip key="discard" label="Available in PR2">
      <DisabledIconChip icon="backspace" label="discard" />
    </ComingSoonTooltip>,
    // 11. discard all — disabled placeholder; staging ships in PR2.
    <ComingSoonTooltip key="discard-all" label="Available in PR2">
      <DisabledIconChip icon="delete_sweep" label="discard all" />
    </ComingSoonTooltip>,
    // 12. highlight dropdown — `lineDiffType` Pierre option.
    <Dropdown
      key="highlight"
      label="highlight"
      value={lineDiffType}
      options={LINE_DIFF_OPTIONS}
      onChange={onLineDiffTypeChange}
      width={260}
    />,
    // 13. theme dropdown — `DiffsThemeNames` enumeration.
    <Dropdown
      key="theme"
      label="theme"
      value={theme}
      options={THEME_OPTIONS}
      onChange={onThemeChange}
    />,
    // 14. View ▾ gear chip — consolidates the indicators / overflow
    // dropdowns and the four boolean toggle chips into a single portal-
    // rendered popover with a Format section (nested sub-dropdowns) and
    // a View Options section (checkbox rows). Replaces six standalone
    // chips that previously stretched the toolbar to ~15 visible items
    // (PR #263 QA feedback — Option A from the design preview).
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

  return (
    <div
      role="toolbar"
      aria-label="Diff toolbar"
      className="px-3 py-2 rounded-lg bg-surface-container-low/50 backdrop-blur-sm border border-outline-variant/10"
    >
      <PriorityPlus maxRows={1}>{chips}</PriorityPlus>
    </div>
  )
}
