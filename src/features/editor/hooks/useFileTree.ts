import { useState, useEffect } from 'react'
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

  const loadTree = async (): Promise<void> => {
    setLoading(true)
    setError(null)

    try {
      const data = await fetchFileTree(root)
      setTree(data)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to load file tree'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadTree()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root])

  return {
    tree,
    loading,
    error,
    refetch: loadTree,
  }
}
