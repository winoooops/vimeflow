import { describe, test, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useEditorBuffer } from './useEditorBuffer'
import type { IFileSystemService } from '../../files/services/fileSystemService'

describe('useEditorBuffer', () => {
  let mockFileSystemService: IFileSystemService

  beforeEach(() => {
    mockFileSystemService = {
      listDir: vi.fn(),
      readFile: vi.fn(),
      writeFile: vi.fn(),
    }
  })

  test('initializes with no file loaded', () => {
    const { result } = renderHook(() => useEditorBuffer(mockFileSystemService))

    expect(result.current.filePath).toBeNull()
    expect(result.current.originalContent).toBe('')
    expect(result.current.currentContent).toBe('')
    expect(result.current.isDirty).toBe(false)
  })

  test('openFile loads file content from fileSystemService', async () => {
    vi.mocked(mockFileSystemService.readFile).mockResolvedValue('const x = 42;')

    const { result } = renderHook(() => useEditorBuffer(mockFileSystemService))

    await act(async () => {
      await result.current.openFile('~/test.ts')
    })

    await waitFor(() => {
      expect(result.current.filePath).toBe('~/test.ts')
      expect(result.current.originalContent).toBe('const x = 42;')
      expect(result.current.currentContent).toBe('const x = 42;')
      expect(result.current.isDirty).toBe(false)
    })

    expect(mockFileSystemService.readFile).toHaveBeenCalledWith('~/test.ts')
  })

  test('openFile handles read errors gracefully', async () => {
    vi.mocked(mockFileSystemService.readFile).mockRejectedValue(
      new Error('File not found')
    )

    const { result } = renderHook(() => useEditorBuffer(mockFileSystemService))

    await expect(
      act(async () => {
        await result.current.openFile('~/missing.ts')
      })
    ).rejects.toThrow('File not found')

    expect(result.current.filePath).toBeNull()
    expect(result.current.originalContent).toBe('')
  })

  test('updateContent changes current content and sets isDirty', async () => {
    vi.mocked(mockFileSystemService.readFile).mockResolvedValue('const x = 42;')

    const { result } = renderHook(() => useEditorBuffer(mockFileSystemService))

    await act(async () => {
      await result.current.openFile('~/test.ts')
    })

    await waitFor(() => {
      expect(result.current.isDirty).toBe(false)
    })

    act(() => {
      result.current.updateContent('const x = 100;')
    })

    expect(result.current.currentContent).toBe('const x = 100;')
    expect(result.current.originalContent).toBe('const x = 42;')
    expect(result.current.isDirty).toBe(true)
  })

  test('updateContent with same content keeps isDirty false', async () => {
    vi.mocked(mockFileSystemService.readFile).mockResolvedValue('const x = 42;')

    const { result } = renderHook(() => useEditorBuffer(mockFileSystemService))

    await act(async () => {
      await result.current.openFile('~/test.ts')
    })

    await waitFor(() => {
      expect(result.current.isDirty).toBe(false)
    })

    act(() => {
      result.current.updateContent('const x = 42;')
    })

    expect(result.current.isDirty).toBe(false)
  })

  test('saveFile writes current content and resets isDirty', async () => {
    vi.mocked(mockFileSystemService.readFile).mockResolvedValue('const x = 42;')
    vi.mocked(mockFileSystemService.writeFile).mockResolvedValue()

    const { result } = renderHook(() => useEditorBuffer(mockFileSystemService))

    await act(async () => {
      await result.current.openFile('~/test.ts')
    })

    await waitFor(() => {
      expect(result.current.isDirty).toBe(false)
    })

    act(() => {
      result.current.updateContent('const x = 100;')
    })

    expect(result.current.isDirty).toBe(true)

    await act(async () => {
      await result.current.saveFile()
    })

    await waitFor(() => {
      expect(result.current.isDirty).toBe(false)
    })

    expect(mockFileSystemService.writeFile).toHaveBeenCalledWith(
      '~/test.ts',
      'const x = 100;'
    )
    expect(result.current.originalContent).toBe('const x = 100;')
  })

  test('saveFile throws error when no file is loaded', async () => {
    const { result } = renderHook(() => useEditorBuffer(mockFileSystemService))

    await expect(
      act(async () => {
        await result.current.saveFile()
      })
    ).rejects.toThrow('No file loaded')

    expect(mockFileSystemService.writeFile).not.toHaveBeenCalled()
  })

  test('saveFile handles write errors gracefully', async () => {
    vi.mocked(mockFileSystemService.readFile).mockResolvedValue('const x = 42;')

    vi.mocked(mockFileSystemService.writeFile).mockRejectedValue(
      new Error('Permission denied')
    )

    const { result } = renderHook(() => useEditorBuffer(mockFileSystemService))

    await act(async () => {
      await result.current.openFile('~/test.ts')
    })

    await waitFor(() => {
      expect(result.current.isDirty).toBe(false)
    })

    act(() => {
      result.current.updateContent('const x = 100;')
    })

    await expect(
      act(async () => {
        await result.current.saveFile()
      })
    ).rejects.toThrow('Permission denied')

    expect(result.current.isDirty).toBe(true)
  })

  test('keeps open files scoped to the active session', async () => {
    vi.mocked(mockFileSystemService.readFile).mockImplementation((path) =>
      Promise.resolve(`content for ${path}`)
    )

    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) =>
        useEditorBuffer(mockFileSystemService, sessionId),
      {
        initialProps: { sessionId: 'session-a' },
      }
    )

    await act(async () => {
      await result.current.openFile('~/a.ts')
    })

    expect(result.current.filePath).toBe('~/a.ts')
    expect(result.current.currentContent).toBe('content for ~/a.ts')

    rerender({ sessionId: 'session-b' })

    expect(result.current.filePath).toBeNull()
    expect(result.current.currentContent).toBe('')

    await act(async () => {
      await result.current.openFile('~/b.ts')
    })

    expect(result.current.filePath).toBe('~/b.ts')
    expect(result.current.currentContent).toBe('content for ~/b.ts')

    rerender({ sessionId: 'session-a' })

    expect(result.current.filePath).toBe('~/a.ts')
    expect(result.current.currentContent).toBe('content for ~/a.ts')
  })

  test('keeps action callbacks stable across active session changes', async () => {
    vi.mocked(mockFileSystemService.readFile).mockImplementation((path) =>
      Promise.resolve(`content for ${path}`)
    )
    vi.mocked(mockFileSystemService.writeFile).mockResolvedValue()

    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) =>
        useEditorBuffer(mockFileSystemService, sessionId),
      {
        initialProps: { sessionId: 'session-a' },
      }
    )

    const initialOpenFile = result.current.openFile
    const initialSaveFile = result.current.saveFile
    const initialUpdateContent = result.current.updateContent

    rerender({ sessionId: 'session-b' })

    expect(result.current.openFile).toBe(initialOpenFile)
    expect(result.current.saveFile).toBe(initialSaveFile)
    expect(result.current.updateContent).toBe(initialUpdateContent)

    await act(async () => {
      await result.current.openFile('~/b.ts')
    })

    act(() => {
      result.current.updateContent('session b edits')
    })

    await act(async () => {
      await result.current.saveFile()
    })

    expect(mockFileSystemService.writeFile).toHaveBeenCalledWith(
      '~/b.ts',
      'session b edits'
    )
  })
})
