/* eslint-disable @typescript-eslint/require-await */
import { describe, test, expect, beforeEach, vi } from 'vitest'
import {
  fetchFileTree,
  fetchFileContent,
  isFileApiError,
  type FileApiError,
  type FileContentResponse,
} from './fileService'
import type { FileNode } from '../types'

// Mock fetch globally
global.fetch = vi.fn()

describe('fileService', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  describe('isFileApiError', () => {
    test('returns true for valid FileApiError', () => {
      const error: FileApiError = { error: 'Test error' }

      expect(isFileApiError(error)).toBe(true)
    })

    test('returns false for invalid values', () => {
      expect(isFileApiError(null)).toBe(false)
      expect(isFileApiError(undefined)).toBe(false)
      expect(isFileApiError('string')).toBe(false)
      expect(isFileApiError({})).toBe(false)
      expect(isFileApiError({ message: 'error' })).toBe(false)
    })
  })

  describe('fetchFileTree', () => {
    test('fetches file tree without root parameter', async () => {
      const mockTree: FileNode[] = [
        {
          id: 'src',
          name: 'src',
          type: 'folder',
          children: [],
        },
      ]

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockTree,
      })

      const result = await fetchFileTree()

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/files/tree')
      )
      expect(result).toEqual(mockTree)
    })

    test('fetches file tree with root parameter', async () => {
      const mockTree: FileNode[] = [
        {
          id: 'components',
          name: 'components',
          type: 'folder',
          children: [],
        },
      ]

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockTree,
      })

      const result = await fetchFileTree('src')

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/files/tree?root=src')
      )
      expect(result).toEqual(mockTree)
    })

    test('throws error when fetch fails', async () => {
      const errorResponse: FileApiError = { error: 'Invalid root path' }

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        statusText: 'Bad Request',
        json: async () => errorResponse,
      })

      await expect(fetchFileTree()).rejects.toThrow('Invalid root path')
    })

    test('throws error with statusText when error message not in response', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        statusText: 'Internal Server Error',
        json: async () => ({}),
      })

      await expect(fetchFileTree()).rejects.toThrow(
        'Failed to fetch file tree: Internal Server Error'
      )
    })
  })

  describe('fetchFileContent', () => {
    test('fetches file content successfully', async () => {
      const mockContent: FileContentResponse = {
        content: 'export default function App() {}',
        language: 'typescript',
      }

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockContent,
      })

      const result = await fetchFileContent('src/App.tsx')

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/files/content?path=src%2FApp.tsx')
      )
      expect(result).toEqual(mockContent)
    })

    test('throws error when file not found', async () => {
      const errorResponse: FileApiError = { error: 'File not found' }

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found',
        json: async () => errorResponse,
      })

      await expect(fetchFileContent('nonexistent.ts')).rejects.toThrow(
        'File not found'
      )
    })

    test('throws error when file is too large', async () => {
      const errorResponse: FileApiError = {
        error: 'File too large (max 1MB)',
      }

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        statusText: 'Payload Too Large',
        json: async () => errorResponse,
      })

      await expect(fetchFileContent('large-file.bin')).rejects.toThrow(
        'File too large (max 1MB)'
      )
    })

    test('throws error when path is invalid', async () => {
      const errorResponse: FileApiError = { error: 'Invalid file path' }

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        statusText: 'Bad Request',
        json: async () => errorResponse,
      })

      await expect(fetchFileContent('../../../etc/passwd')).rejects.toThrow(
        'Invalid file path'
      )
    })
  })
})
