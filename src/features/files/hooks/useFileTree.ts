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

/** Detect the home directory prefix from common absolute paths */
const detectHomePath = (): string | null => {
  // In browser, we can't detect home — return null
  if (typeof process === 'undefined') {
    return null
  }

  // Node/Tauri environment
  return process.env.HOME ?? process.env.USERPROFILE ?? null
}

const homePath = detectHomePath()

/** Normalize an absolute path: replace home prefix with ~ */
const normalizeToTilde = (path: string): string => {
  if (!homePath) {
    return path
  }
  if (path === homePath) {
    return '~'
  }
  if (path.startsWith(`${homePath}/`)) {
    return `~${path.slice(homePath.length)}`
  }

  return path
}

export const useFileTree = (externalCwd: string): UseFileTreeResult => {
  const [currentPath, setCurrentPath] = useState(normalizeToTilde(externalCwd))
  const [nodes, setNodes] = useState<FileNode[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const service = useMemo(() => createFileSystemService(), [])
  // Generation counter — incremented on every load to discard stale responses
  const generation = useRef(0)

  // Sync with external cwd changes (session switch, OSC 7)
  // Normalize absolute home paths to ~ so navigation stays within bounds
  useEffect(() => {
    setCurrentPath(normalizeToTilde(externalCwd))
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
      // Handle Windows drive roots (e.g. C:/ or C:\)
      if (/^[A-Za-z]:[/\\]?$/.test(prev)) {
        return prev
      }
      // Handle absolute paths
      const parent = prev.replace(/\/[^/]+\/?$/, '')

      // Ensure Windows drive paths keep trailing slash (C:/ not C:)
      if (/^[A-Za-z]:$/.test(parent)) {
        return `${parent}/`
      }

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
