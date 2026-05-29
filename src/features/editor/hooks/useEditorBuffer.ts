import { useState, useCallback, useRef } from 'react'
import type { IFileSystemService } from '../../files/services/fileSystemService'

const DEFAULT_EDITOR_BUFFER_SCOPE_ID = '__workspace_editor_buffer__'

interface EditorBufferState {
  filePath: string | null
  originalContent: string
  currentContent: string
  isLoading: boolean
}

type EditorBuffersByScope = Partial<Record<string, EditorBufferState>>
type OpenRequestIdsByScope = Partial<Record<string, number>>

const EMPTY_EDITOR_BUFFER: EditorBufferState = {
  filePath: null,
  originalContent: '',
  currentContent: '',
  isLoading: false,
}

const resolveEditorBufferScopeId = (scopeId: string | null): string =>
  scopeId ?? DEFAULT_EDITOR_BUFFER_SCOPE_ID

export interface EditorBuffer {
  filePath: string | null
  originalContent: string
  currentContent: string
  isDirty: boolean
  /**
   * True while an `openFile` IPC call is in flight. Parent components
   * can render a loading overlay on top of the editor so users have
   * feedback that their file click registered — the editor otherwise
   * keeps showing the previous buffer during the round-trip, which is
   * visually ambiguous on slow disks or permission-checked reads.
   */
  isLoading: boolean
  openFile: (path: string) => Promise<void>
  saveFile: (scopeId?: string) => Promise<void>
  updateContent: (content: string) => void
  hasUnsavedChanges: (scopeId: string) => boolean
  releaseScope: (scopeId: string) => void
}

export const useEditorBuffer = (
  fileSystemService: IFileSystemService,
  scopeId: string | null = null
): EditorBuffer => {
  const activeScopeId = resolveEditorBufferScopeId(scopeId)
  const [buffersByScope, setBuffersByScope] = useState<EditorBuffersByScope>({})
  const activeScopeIdRef = useRef(activeScopeId)
  const buffersByScopeRef = useRef<EditorBuffersByScope>({})
  const openRequestIdsRef = useRef<OpenRequestIdsByScope>({})

  activeScopeIdRef.current = activeScopeId
  buffersByScopeRef.current = buffersByScope

  const activeBuffer = buffersByScope[activeScopeId] ?? EMPTY_EDITOR_BUFFER

  const isDirty = activeBuffer.currentContent !== activeBuffer.originalContent

  const setBufferForScope = useCallback(
    (
      targetScopeId: string,
      updateBuffer: (buffer: EditorBufferState) => EditorBufferState
    ): void => {
      const previousBuffers = buffersByScopeRef.current

      const previousBuffer =
        previousBuffers[targetScopeId] ?? EMPTY_EDITOR_BUFFER
      const nextBuffer = updateBuffer(previousBuffer)

      if (nextBuffer === previousBuffer) {
        return
      }

      const nextBuffers = {
        ...previousBuffers,
        [targetScopeId]: nextBuffer,
      }

      buffersByScopeRef.current = nextBuffers
      setBuffersByScope(nextBuffers)
    },
    []
  )

  // Monotonically-increasing counter for last-write-wins semantics on
  // concurrent openFile calls. Each invocation captures its own id at
  // the start and checks it against the ref AFTER the await. If another
  // openFile was kicked off in the meantime, the stale response is
  // silently discarded so filePath/originalContent/currentContent
  // stay in sync with whichever file the user clicked most recently.
  //
  // Without this guard, two rapid clicks within the IPC round-trip
  // window could leave the editor showing file A's content while
  // filePath is file B — a subsequent :w would then overwrite B's
  // on-disk contents with A's buffer (silent data corruption).
  const openFile = useCallback(
    async (path: string): Promise<void> => {
      const targetScopeId = activeScopeIdRef.current
      const requestId = (openRequestIdsRef.current[targetScopeId] ?? 0) + 1
      openRequestIdsRef.current = {
        ...openRequestIdsRef.current,
        [targetScopeId]: requestId,
      }

      setBufferForScope(targetScopeId, (buffer) => ({
        ...buffer,
        isLoading: true,
      }))
      try {
        const content = await fileSystemService.readFile(path)

        // Last-write-wins: ignore stale responses.
        if (requestId !== openRequestIdsRef.current[targetScopeId]) {
          return
        }

        setBufferForScope(targetScopeId, () => ({
          filePath: path,
          originalContent: content,
          currentContent: content,
          isLoading: false,
        }))
      } catch (error: unknown) {
        if (requestId !== openRequestIdsRef.current[targetScopeId]) {
          return
        }

        setBufferForScope(targetScopeId, (buffer) => ({
          ...buffer,
          isLoading: false,
        }))
        throw error
      }
    },
    [fileSystemService, setBufferForScope]
  )

  const saveFile = useCallback(
    async (scopeIdToSave?: string): Promise<void> => {
      const targetScopeId = scopeIdToSave ?? activeScopeIdRef.current

      const buffer =
        buffersByScopeRef.current[targetScopeId] ?? EMPTY_EDITOR_BUFFER

      if (!buffer.filePath) {
        throw new Error('No file loaded')
      }

      const filePath = buffer.filePath
      const content = buffer.currentContent

      await fileSystemService.writeFile(filePath, content)
      setBufferForScope(targetScopeId, (currentBuffer) => {
        if (currentBuffer.filePath !== filePath) {
          return currentBuffer
        }

        return {
          ...currentBuffer,
          originalContent: content,
        }
      })
    },
    [fileSystemService, setBufferForScope]
  )

  const updateContent = useCallback(
    (content: string): void => {
      const targetScopeId = activeScopeIdRef.current

      setBufferForScope(targetScopeId, (buffer) => ({
        ...buffer,
        currentContent: content,
      }))
    },
    [setBufferForScope]
  )

  const hasUnsavedChanges = useCallback((scopeIdToCheck: string): boolean => {
    const buffer = buffersByScopeRef.current[scopeIdToCheck]

    if (!buffer) {
      return false
    }

    return buffer.currentContent !== buffer.originalContent
  }, [])

  const releaseScope = useCallback((scopeIdToRelease: string): void => {
    const previousBuffers = buffersByScopeRef.current

    if (previousBuffers[scopeIdToRelease]) {
      const nextBuffers = { ...previousBuffers }
      delete nextBuffers[scopeIdToRelease]
      buffersByScopeRef.current = nextBuffers
      setBuffersByScope(nextBuffers)
    }

    if (openRequestIdsRef.current[scopeIdToRelease] !== undefined) {
      const nextOpenRequestIds = { ...openRequestIdsRef.current }
      delete nextOpenRequestIds[scopeIdToRelease]
      openRequestIdsRef.current = nextOpenRequestIds
    }
  }, [])

  return {
    filePath: activeBuffer.filePath,
    originalContent: activeBuffer.originalContent,
    currentContent: activeBuffer.currentContent,
    isDirty,
    isLoading: activeBuffer.isLoading,
    openFile,
    saveFile,
    updateContent,
    hasUnsavedChanges,
    releaseScope,
  }
}
