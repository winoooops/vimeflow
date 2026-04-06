import { describe, test, expect } from 'vitest'
import { mockEditorState } from './mockEditorState'

describe('mockEditorState', () => {
  test('should have valid EditorState structure', () => {
    expect(mockEditorState).toHaveProperty('openFiles')
    expect(mockEditorState).toHaveProperty('activeFileIndex')
    expect(mockEditorState).toHaveProperty('vimMode')
    expect(mockEditorState).toHaveProperty('cursorPosition')
    expect(mockEditorState).toHaveProperty('showMinimap')
  })

  test('should have array of open files', () => {
    expect(Array.isArray(mockEditorState.openFiles)).toBe(true)
    expect(mockEditorState.openFiles.length).toBeGreaterThan(0)
  })

  test('activeFileIndex should be valid', () => {
    expect(typeof mockEditorState.activeFileIndex).toBe('number')
    expect(mockEditorState.activeFileIndex).toBeGreaterThanOrEqual(0)
    expect(mockEditorState.activeFileIndex).toBeLessThan(
      mockEditorState.openFiles.length
    )
  })

  test('vimMode should be a valid mode', () => {
    expect(['NORMAL', 'INSERT', 'VISUAL']).toContain(mockEditorState.vimMode)
  })

  test('cursorPosition should have line and column', () => {
    expect(mockEditorState.cursorPosition).toHaveProperty('line')
    expect(mockEditorState.cursorPosition).toHaveProperty('column')
    expect(typeof mockEditorState.cursorPosition.line).toBe('number')
    expect(typeof mockEditorState.cursorPosition.column).toBe('number')
    expect(mockEditorState.cursorPosition.line).toBeGreaterThanOrEqual(0)
    expect(mockEditorState.cursorPosition.column).toBeGreaterThanOrEqual(0)
  })

  test('showMinimap should be boolean', () => {
    expect(typeof mockEditorState.showMinimap).toBe('boolean')
  })
})
