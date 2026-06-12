import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { expect, test } from 'vitest'
import { createEditorTheme } from './editorTheme'

test('dark kind sets the darkTheme facet, light does not', () => {
  const dark = EditorState.create({ extensions: createEditorTheme('dark') })
  const light = EditorState.create({ extensions: createEditorTheme('light') })
  expect(dark.facet(EditorView.darkTheme)).toBe(true)
  expect(light.facet(EditorView.darkTheme)).toBe(false)
})
