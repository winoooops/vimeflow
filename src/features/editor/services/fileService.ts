import type { FileNode } from '../types'

/**
 * Response from /api/files/content endpoint
 */
export interface FileContentResponse {
  content: string
  language: string
}

/**
 * Error response from file API
 */
export interface FileApiError {
  error: string
}

/**
 * Type guard for FileApiError
 */
export function isFileApiError(value: unknown): value is FileApiError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as FileApiError).error === 'string'
  )
}

/**
 * Fetch file tree from the file service
 * @param root - Optional root path to start from (default: repository root)
 */
export async function fetchFileTree(root?: string): Promise<FileNode[]> {
  const url = new URL('/api/files/tree', window.location.origin)

  if (root) {
    url.searchParams.set('root', root)
  }

  const response = await fetch(url.toString())

  if (!response.ok) {
    const error = (await response.json()) as FileApiError
    throw new Error(
      error.error || `Failed to fetch file tree: ${response.statusText}`
    )
  }

  const tree = (await response.json()) as FileNode[]

  return tree
}

/**
 * Fetch file content from the file service
 * @param filePath - Path to the file relative to repository root
 */
export async function fetchFileContent(
  filePath: string
): Promise<FileContentResponse> {
  const url = new URL('/api/files/content', window.location.origin)
  url.searchParams.set('path', filePath)

  const response = await fetch(url.toString())

  if (!response.ok) {
    const error = (await response.json()) as FileApiError
    throw new Error(
      error.error || `Failed to fetch file content: ${response.statusText}`
    )
  }

  const data = (await response.json()) as FileContentResponse

  return data
}
