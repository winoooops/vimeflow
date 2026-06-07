// Reading-style presets for the markdown reading view. A user-facing, runtime
// switcher (the ⚙ menu in the dock header) picks one; the choice is persisted
// as a UI preference (see utils/readingStyleStore). Body uses `fontPx` and
// headings scale from it (em), so a single base size drives the whole document.

export type ReadingStyleId = 'compact' | 'comfortable' | 'spacious'

export interface ReadingStyle {
  id: ReadingStyleId
  label: string
  /** Base body font size in px. Headings scale from it via em. */
  fontPx: number
  lineHeight: number
  /** Reading measure (max line length) in `ch`. */
  measureCh: number
  /**
   * CSS `padding-inline` for the scroll region. Uses the `cqi` container-query
   * unit (not `vw`) so the side gutter tracks the dock PANE width, not the
   * window — correct whether the dock is narrow (left/right) or wide (bottom).
   * Requires `container-type: inline-size` on the scroll container.
   */
  paddingInline: string
}

const COMPACT: ReadingStyle = {
  id: 'compact',
  label: 'Compact',
  fontPx: 16,
  lineHeight: 1.6,
  measureCh: 78,
  paddingInline: 'clamp(14px, 2cqi, 56px)',
}

const COMFORTABLE: ReadingStyle = {
  id: 'comfortable',
  label: 'Comfortable',
  fontPx: 18.5,
  lineHeight: 1.65,
  measureCh: 75,
  paddingInline: 'clamp(16px, 2.5cqi, 100px)',
}

const SPACIOUS: ReadingStyle = {
  id: 'spacious',
  label: 'Spacious',
  fontPx: 20,
  lineHeight: 1.7,
  measureCh: 72,
  paddingInline: 'clamp(22px, 3cqi, 128px)',
}

export const READING_STYLES: readonly ReadingStyle[] = [
  COMPACT,
  COMFORTABLE,
  SPACIOUS,
]

/** Default when nothing is persisted — the tuned "your pick" comfortable size. */
export const DEFAULT_READING_STYLE: ReadingStyle = COMFORTABLE

export const isReadingStyleId = (value: unknown): value is ReadingStyleId =>
  value === 'compact' || value === 'comfortable' || value === 'spacious'

export const getReadingStyle = (id: ReadingStyleId): ReadingStyle =>
  READING_STYLES.find((style) => style.id === id) ?? DEFAULT_READING_STYLE
