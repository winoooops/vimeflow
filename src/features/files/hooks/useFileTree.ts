import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { FileNode } from '../types'
import { createFileSystemService } from '../services/fileSystemService'

export interface UseFileTreeResult {
  nodes: FileNode[]
  currentPath: string
  isLoading: boolean
  error: string | null
  refresh: () => void
  navigateTo: (path: string) => void
  navigateUp: () => void
}

export const useFileTree = (externalCwd: string): UseFileTreeResult => {
  const [currentPath, setCurrentPath] = useState(externalCwd)
  const [nodes, setNodes] = useState<FileNode[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const service = useMemo(() => createFileSystemService(), [])
  // Generation counter — incremented on every load to discard stale responses
  const generation = useRef(0)

  // Sync with external cwd changes (session switch, OSC 7)
  useEffect(() => {
    setCurrentPath(externalCwd)
  }, [externalCwd])

  const load = useCallback(
    async (path: string): Promise<void> => {
      const thisGen = ++generation.current
      setIsLoading(true)
      setError(null)
      try {
        const entries = await service.listDir(path)
        // Only apply if this is still the latest request
        if (thisGen !== generation.current) {
          return
        }
        setNodes(entries)
      } catch (e: unknown) {
        if (thisGen !== generation.current) {
          return
        }
        const msg = e instanceof Error ? e.message : 'Failed to list directory'
        setError(msg)
      } finally {
        if (thisGen === generation.current) {
          setIsLoading(false)
        }
      }
    },
    [service]
  )

  useEffect(() => {
    void load(currentPath)
  }, [currentPath, load])

  const refresh = useCallback((): void => {
    void load(currentPath)
  }, [currentPath, load])

  const navigateTo = useCallback((path: string): void => {
    setCurrentPath(path)
  }, [])

  const navigateUp = useCallback((): void => {
    setCurrentPath((prev) => {
      // Handle ~ paths
      if (prev === '~' || prev === '/') {
        return prev
      }
      if (prev.startsWith('~/')) {
        const parent = prev.replace(/\/[^/]+\/?$/, '')

        return parent || '~'
      }
      // Handle absolute paths
      const parent = prev.replace(/\/[^/]+\/?$/, '')

      return parent || '/'
    })
  }, [])

  return {
    nodes,
    currentPath,
    isLoading,
    error,
    refresh,
    navigateTo,
    navigateUp,
  }
}
