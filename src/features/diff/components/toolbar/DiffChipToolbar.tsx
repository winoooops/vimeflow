import type { ReactElement, ReactNode } from 'react'
import type { BaseDiffOptions, DiffsThemeNames } from '@pierre/diffs'
import { Tooltip } from '../../../../components/Tooltip'
import { Dropdown, type DropdownOption } from './Dropdown'
import { PriorityPlus } from './PriorityPlus'
import { Segmented } from './Segmented'
import { Toggle } from './Toggle'

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

const INDICATOR_OPTIONS: readonly DropdownOption<DiffIndicators>[] = [
  { value: 'classic', label: 'classic', description: 'Plus and minus glyphs' },
  { value: 'bars', label: 'bars', description: 'Colored gutter bars' },
  { value: 'none', label: 'none', description: 'No indicator column' },
]

const OVERFLOW_OPTIONS: readonly DropdownOption<Overflow>[] = [
  {
    value: 'scroll',
    label: 'scroll',
    description: 'Horizontal scroll for long lines',
  },
  {
    value: 'wrap',
    label: 'wrap',
    description: 'Soft-wrap long lines to next row',
  },
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
  // counter chip renders `0/0`. In PR1 prev/next/staging are disabled
  // placeholders; PR2 wires the click handlers via Task 2.5.
  totalHunks?: number
  focusedHunkIndex?: number
}

// Styling shared by every icon-button chip — the staging chips, the prev/next
// hunk chips, and the counter. Disabled chips use a muted surface tone and the
// `not-allowed` cursor so it is obvious they are placeholders.
const DISABLED_ICON_CHIP_CLASSES =
  'inline-flex items-center justify-center w-8 h-8 rounded-md ' +
  'bg-surface-container/20 text-on-surface-variant/40 cursor-not-allowed ' +
  'transition-colors'

// The hunk counter is a text chip — non-interactive, just a label.
const COUNTER_CHIP_CLASSES =
  'inline-flex items-center justify-center min-w-[3rem] h-8 px-2 rounded-md ' +
  'bg-surface-container/40 text-on-surface-variant text-[0.7rem] ' +
  'font-mono tracking-tight'

// Wrap a disabled chip in the standard "Available in PR2" tooltip so users
// know the placeholders will light up later. Centralized so the copy stays
// consistent and a future rename is a one-line change.
const PR2Tooltip = ({ children }: { children: ReactElement }): ReactElement => (
  <Tooltip content="Available in PR2">{children}</Tooltip>
)

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

// Composed chip toolbar. Pure controlled component — all state lives in the
// consumer. PriorityPlus measures the rendered chips and folds anything
// beyond the first row into a portal-rendered `…` menu (last items overflow
// first, so toggles drop before dropdowns drop before navigation chips).
//
// In PR1 the staging chips (stage / unstage / discard / discard all) and the
// prev/next/counter hunk chips render disabled — they keep the UI shape
// visually complete from the first PR even though the IPC behind them ships
// in PR2. Tooltips on the disabled chips read "Available in PR2".
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
}: DiffChipToolbarProps): ReactElement => {
  // Counter copy: `1/N` when there is at least one hunk, `0/0` otherwise.
  // PR1 shows the current focused index as `focusedHunkIndex + 1` so the
  // counter is consistent with PR2 once prev/next start mutating the index.
  const counterText =
    totalHunks > 0 ? `${focusedHunkIndex + 1}/${totalHunks}` : '0/0'

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
    // 2. prev hunk — disabled placeholder in PR1; Task 2.5 wires the click.
    <PR2Tooltip key="prev-hunk">
      <DisabledIconChip icon="chevron_left" label="prev hunk" />
    </PR2Tooltip>,
    // 3. hunk N/M counter — text chip; reads `1/totalHunks` until PR2 starts
    // mutating the focus index.
    <span
      key="hunk-counter"
      aria-label={`hunk ${counterText}`}
      className={COUNTER_CHIP_CLASSES}
    >
      {counterText}
    </span>,
    // 4. next hunk — disabled placeholder in PR1.
    <PR2Tooltip key="next-hunk">
      <DisabledIconChip icon="chevron_right" label="next hunk" />
    </PR2Tooltip>,
    // 5. stage — disabled placeholder in PR1.
    <PR2Tooltip key="stage">
      <DisabledIconChip icon="add_box" label="stage" />
    </PR2Tooltip>,
    // 6. unstage — only rendered on the staged diff view. On unstaged diffs
    // the chip is omitted entirely (per spec Section 4.7) because the
    // operation is meaningless there.
    ...(diffMode === 'staged'
      ? [
          <PR2Tooltip key="unstage">
            <DisabledIconChip icon="indeterminate_check_box" label="unstage" />
          </PR2Tooltip>,
        ]
      : []),
    // 7. discard — disabled placeholder in PR1.
    <PR2Tooltip key="discard">
      <DisabledIconChip icon="backspace" label="discard" />
    </PR2Tooltip>,
    // 8. discard all — disabled placeholder in PR1.
    <PR2Tooltip key="discard-all">
      <DisabledIconChip icon="delete_sweep" label="discard all" />
    </PR2Tooltip>,
    // 9. highlight dropdown — `lineDiffType` Pierre option.
    <Dropdown
      key="highlight"
      label="highlight"
      value={lineDiffType}
      options={LINE_DIFF_OPTIONS}
      onChange={onLineDiffTypeChange}
      width={260}
    />,
    // 10. theme dropdown — `DiffsThemeNames` enumeration.
    <Dropdown
      key="theme"
      label="theme"
      value={theme}
      options={THEME_OPTIONS}
      onChange={onThemeChange}
    />,
    // 11. indicators dropdown.
    <Dropdown
      key="indicators"
      label="indicators"
      value={diffIndicators}
      options={INDICATOR_OPTIONS}
      onChange={onDiffIndicatorsChange}
      width={220}
    />,
    // 12. overflow dropdown.
    <Dropdown
      key="overflow"
      label="overflow"
      value={overflow}
      options={OVERFLOW_OPTIONS}
      onChange={onOverflowChange}
      width={240}
    />,
    // 13. line numbers toggle — `disableLineNumbers` inverted so the chip
    // reads `on / off` naturally instead of `disable on / disable off`.
    <Toggle
      key="line-numbers"
      label="line numbers"
      value={!disableLineNumbers}
      onChange={(next): void => onDisableLineNumbersChange(!next)}
    />,
    // 14. background tint toggle — also inverted.
    <Toggle
      key="background"
      label="background tint"
      value={!disableBackground}
      onChange={(next): void => onDisableBackgroundChange(!next)}
    />,
    // 15. file header toggle — also inverted.
    <Toggle
      key="file-header"
      label="file header"
      value={!disableFileHeader}
      onChange={(next): void => onDisableFileHeaderChange(!next)}
    />,
    // 16. sticky header toggle — direct, no inversion.
    <Toggle
      key="sticky-header"
      label="sticky header"
      value={stickyHeader}
      onChange={onStickyHeaderChange}
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
