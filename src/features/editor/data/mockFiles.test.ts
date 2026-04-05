import { describe, test, expect } from 'vitest'
import { mockFiles } from './mockFiles'
import type { EditorFile } from '../types'

describe('mockFiles', () => {
  test('should export an array of EditorFile objects', () => {
    expect(Array.isArray(mockFiles)).toBe(true)
    expect(mockFiles.length).toBeGreaterThan(0)
  })

  test('each file should have required EditorFile properties', () => {
    mockFiles.forEach((file: EditorFile) => {
      expect(file).toHaveProperty('id')
      expect(file).toHaveProperty('path')
      expect(file).toHaveProperty('name')
      expect(file).toHaveProperty('language')
      expect(file).toHaveProperty('modified')
      expect(file).toHaveProperty('encoding')
      expect(file).toHaveProperty('content')

      expect(typeof file.id).toBe('string')
      expect(typeof file.path).toBe('string')
      expect(typeof file.name).toBe('string')
      expect(typeof file.language).toBe('string')
      expect(typeof file.modified).toBe('boolean')
      expect(typeof file.encoding).toBe('string')
      expect(typeof file.content).toBe('string')
    })
  })

  test('file IDs should be unique', () => {
    const ids = mockFiles.map((file) => file.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(ids.length)
  })

  test('file paths should match file names', () => {
    mockFiles.forEach((file) => {
      expect(file.path).toContain(file.name)
    })
  })

  test('files should have realistic content', () => {
    mockFiles.forEach((file) => {
      expect(file.content.length).toBeGreaterThan(0)
      // TypeScript files should contain TypeScript syntax
      if (file.language === 'typescript') {
        expect(
          file.content.includes('import') ||
            file.content.includes('export') ||
            file.content.includes('interface') ||
            file.content.includes('type')
        ).toBe(true)
      }
    })
  })

  test('encoding should be UTF-8', () => {
    mockFiles.forEach((file) => {
      expect(file.encoding).toBe('UTF-8')
    })
  })

  test('should have mix of modified and unmodified files', () => {
    const modifiedCount = mockFiles.filter((file) => file.modified).length
    const unmodifiedCount = mockFiles.filter((file) => !file.modified).length

    // At least one of each type for realistic testing
    expect(modifiedCount).toBeGreaterThan(0)
    expect(unmodifiedCount).toBeGreaterThan(0)
  })
})
