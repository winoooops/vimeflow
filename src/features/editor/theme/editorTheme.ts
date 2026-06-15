import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import type { ThemeKind } from '../../../theme'

// Editing-surface mono stack; mirrors Tailwind's `mono` token.
export const EDITOR_MONO_FONT_FAMILY =
  '"Ioskeley Mono", "JetBrains Mono", ui-monospace, monospace'

const c = (token: string): string => `var(--color-${token})`

const mix = (token: string, pct: number): string =>
  `color-mix(in srgb, var(--color-${token}) ${pct}%, transparent)`

const buildTheme = (kind: ThemeKind): Extension =>
  EditorView.theme(
    {
      // `&` targets `.cm-editor`. `height: 100%` is load-bearing — see the
      // canonical CM6 "fill container" recipe note in the git history of
      // theme/catppuccin.ts (PR #228 era): without it .cm-scroller never
      // overflows and vim scroll-follow has no scrollable ancestor.
      '&': {
        backgroundColor: c('surface'),
        color: c('editor-fg'),
        height: '100%',
      },
      '.cm-scroller': {
        overflow: 'auto',
        fontFamily: EDITOR_MONO_FONT_FAMILY,
      },
      '.cm-content': {
        caretColor: c('primary'),
      },
      '&.cm-focused .cm-cursor': {
        borderLeftColor: c('primary'),
      },
      '&.cm-focused .cm-selectionBackground, ::selection': {
        backgroundColor: mix('primary', 25),
      },
      '.cm-selectionBackground': {
        backgroundColor: mix('primary', 19),
      },
      '.cm-activeLine': {
        backgroundColor: c('surface-container'),
      },
      '.cm-gutters': {
        backgroundColor: c('surface-container-low'),
        color: c('syn-comment'),
        border: 'none',
      },
      '.cm-activeLineGutter': {
        backgroundColor: c('surface-container'),
      },
      '.cm-lineNumbers .cm-gutterElement': {
        padding: '0 8px 0 8px',
        minWidth: '40px',
      },
      '.cm-matchingBracket': {
        backgroundColor: mix('syn-keyword', 30),
        outline: 'none',
      },
      '.cm-nonmatchingBracket': {
        backgroundColor: mix('syn-type', 20),
      },
    },
    { dark: kind === 'dark' }
  )

const highlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: c('syn-keyword') },
  { tag: [t.name, t.deleted, t.character, t.macroName], color: c('editor-fg') },
  { tag: [t.propertyName], color: c('syn-fn') },
  { tag: [t.variableName], color: c('syn-variable') },
  { tag: [t.function(t.variableName)], color: c('syn-fn') },
  { tag: [t.labelName], color: c('syn-keyword') },
  {
    tag: [t.color, t.constant(t.name), t.standard(t.name)],
    color: c('syn-type'),
  },
  { tag: [t.definition(t.name), t.separator], color: c('editor-fg') },
  { tag: [t.className], color: c('syn-class') },
  {
    tag: [t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace],
    color: c('syn-type'),
  },
  { tag: [t.typeName], color: c('syn-class') },
  { tag: [t.operator, t.operatorKeyword], color: c('syn-operator') },
  { tag: [t.url, t.escape, t.regexp, t.link], color: c('syn-string') },
  { tag: [t.meta, t.comment], color: c('syn-comment') },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.link, textDecoration: 'underline' },
  { tag: t.heading, fontWeight: 'bold', color: c('syn-keyword') },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: c('syn-type') },
  { tag: t.invalid, color: c('syn-type') },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.string, color: c('syn-string') },
])

/** Theme extension for the given kind. Colors are CSS variables — only the
 * dark/light base facet differs, so a theme switch only needs a Compartment
 * reconfigure when `kind` changes. */
export const createEditorTheme = (kind: ThemeKind): Extension => [
  buildTheme(kind),
  syntaxHighlighting(highlightStyle),
]
