import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

/**
 * Catppuccin Mocha theme for CodeMirror 6
 * Matches the Obsidian Lens design system
 */

// Catppuccin Mocha color palette
const colors = {
  // Base colors
  base: '#1e1e2e', // surface-container
  surface: '#121221', // surface
  surfaceLow: '#1a1a2a', // surface-container-low
  surfaceHigh: '#292839', // surface-container-high

  // Text colors
  text: '#cdd6f4', // text-on-surface
  subtext: '#a6adc8', // text-on-surface-variant
  overlay: '#6c7086', // outline

  // Accent colors
  primary: '#e2c7ff', // primary
  mauve: '#cba6f7',
  blue: '#89b4fa',
  sky: '#89dceb',
  green: '#a6e3a1',
  yellow: '#f9e2af',
  peach: '#fab387',
  rosewater: '#f5e0dc',
}

/**
 * Editor theme - UI elements
 */
const theme = EditorView.theme(
  {
    // `&` targets `.cm-editor`. `height: 100%` is load-bearing:
    // without it, CodeMirror sizes `.cm-editor` to its content, which
    // makes `.cm-scroller` the same height as the full document. The
    // scroller then has no overflow, so no scrollbar appears, mouse
    // wheel does nothing, and any `scrollIntoView` effect (including
    // the one our transactionExtender dispatches for vim normal-mode
    // motions) has no scrollable ancestor to act on. Pairing this
    // with `.cm-scroller { overflow: auto }` is the canonical CM6
    // "fill container" recipe, required for the surrounding flex
    // chain's bounded height to actually reach the editor viewport.
    '&': {
      backgroundColor: colors.surface,
      color: colors.text,
      height: '100%',
    },
    '.cm-scroller': {
      overflow: 'auto',
    },
    '.cm-content': {
      caretColor: colors.primary,
    },
    '&.cm-focused .cm-cursor': {
      borderLeftColor: colors.primary,
    },
    '&.cm-focused .cm-selectionBackground, ::selection': {
      backgroundColor: `${colors.primary}40`, // primary at 25% — visible in visual mode
    },
    '.cm-selectionBackground': {
      backgroundColor: `${colors.primary}30`, // primary at 19% — unfocused
    },
    '.cm-activeLine': {
      backgroundColor: colors.base,
    },
    '.cm-gutters': {
      backgroundColor: colors.surfaceLow,
      color: colors.overlay,
      border: 'none',
    },
    '.cm-activeLineGutter': {
      backgroundColor: colors.base,
    },
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 8px 0 8px',
      minWidth: '40px',
    },
    '.cm-matchingBracket': {
      backgroundColor: `${colors.mauve}4d`, // 30% opacity
      outline: 'none',
    },
    '.cm-nonmatchingBracket': {
      backgroundColor: `${colors.peach}33`, // 20% opacity
    },
  },
  { dark: true }
)

/**
 * Syntax highlighting theme
 */
const highlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: colors.mauve },
  { tag: [t.name, t.deleted, t.character, t.macroName], color: colors.text },
  { tag: [t.propertyName], color: colors.blue },
  { tag: [t.variableName], color: colors.rosewater },
  { tag: [t.function(t.variableName)], color: colors.blue },
  { tag: [t.labelName], color: colors.mauve },
  {
    tag: [t.color, t.constant(t.name), t.standard(t.name)],
    color: colors.peach,
  },
  { tag: [t.definition(t.name), t.separator], color: colors.text },
  { tag: [t.className], color: colors.yellow },
  {
    tag: [t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace],
    color: colors.peach,
  },
  { tag: [t.typeName], color: colors.yellow },
  { tag: [t.operator, t.operatorKeyword], color: colors.sky },
  { tag: [t.url, t.escape, t.regexp, t.link], color: colors.green },
  { tag: [t.meta, t.comment], color: colors.overlay },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.link, textDecoration: 'underline' },
  { tag: t.heading, fontWeight: 'bold', color: colors.mauve },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: colors.peach },
  { tag: t.invalid, color: colors.peach },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.string, color: colors.green },
])

/**
 * Combined Catppuccin Mocha theme extension for CodeMirror
 */
export const catppuccinMocha: Extension = [
  theme,
  syntaxHighlighting(highlightStyle),
]
