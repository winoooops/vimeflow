import { useState, useEffect, useRef, useCallback } from 'react'
import { fetchFileTree } from '../services/fileService'
import type { FileNode } from '../types'

export interface UseFileTreeResult {
  tree: FileNode[]
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
}

/**
 * Hook to fetch and manage file tree state
 * @param root - Optional root path to start from
 */
export function useFileTree(root?: string): UseFileTreeResult {
  const [tree, setTree] = useState<FileNode[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const isMountedRef = useRef<boolean>(true)

  const loadTree = useCallback(async (): Promise<void> => {
    // Check if component is still mounted before starting
    const checkMounted = (): boolean => isMountedRef.current

    if (!checkMounted()) {
      return
    }

    setLoading(true)
    setError(null)

    try {
      const data = await fetchFileTree(root)

      if (checkMounted()) {
        setTree(data)
      }
    } catch (err) {
      if (checkMounted()) {
        const message =
          err instanceof Error ? err.message : 'Failed to load file tree'
        setError(message)
      }
    } finally {
      if (checkMounted()) {
        setLoading(false)
      }
    }
  }, [root])

  useEffect((): (() => void) => {
    isMountedRef.current = true
    void loadTree()

    return (): void => {
      isMountedRef.current = false
    }
  }, [loadTree])

  return {
    tree,
    loading,
    error,
    refetch: loadTree,
  }
}
