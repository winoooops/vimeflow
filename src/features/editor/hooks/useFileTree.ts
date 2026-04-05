import { useState, useEffect, useRef } from 'react'
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

  const loadTree = async (): Promise<void> => {
    if (!isMountedRef.current) {
      return
    }

    setLoading(true)
    setError(null)

    try {
      const data = await fetchFileTree(root)
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (isMountedRef.current) {
        setTree(data)
      }
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (isMountedRef.current) {
        const message =
          err instanceof Error ? err.message : 'Failed to load file tree'
        setError(message)
      }
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (isMountedRef.current) {
        setLoading(false)
      }
    }
  }

  useEffect((): (() => void) => {
    isMountedRef.current = true
    void loadTree()

    return (): void => {
      isMountedRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root])

  return {
    tree,
    loading,
    error,
    refetch: loadTree,
  }
}
