import type { EditorFile } from '../types'

export const mockFiles: EditorFile[] = [
  {
    id: 'file-1',
    path: 'src/components/UserCard.tsx',
    name: 'UserCard.tsx',
    language: 'typescript',
    modified: false,
    encoding: 'UTF-8',
    content: `import { useState } from 'react'
import type { ReactElement } from 'react'

interface User {
  id: string
  name: string
  email: string
  avatar?: string
}

interface UserCardProps {
  user: User
  onSelect?: (userId: string) => void
}

export const UserCard = ({ user, onSelect }: UserCardProps): ReactElement => {
  const [isHovered, setIsHovered] = useState(false)

  const handleClick = (): void => {
    onSelect?.(user.id)
  }

  return (
    <div
      className="flex items-center gap-3 p-4 rounded-lg bg-surface-container hover:bg-surface-container-high cursor-pointer transition-colors"
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {user.avatar ? (
        <img
          src={user.avatar}
          alt={user.name}
          className="w-12 h-12 rounded-full"
        />
      ) : (
        <div className="w-12 h-12 rounded-full bg-primary-container flex items-center justify-center">
          <span className="text-on-primary-container font-medium">
            {user.name.charAt(0)}
          </span>
        </div>
      )}
      <div className="flex-1">
        <h3 className="text-on-surface font-medium">{user.name}</h3>
        <p className="text-on-surface-variant text-sm">{user.email}</p>
      </div>
      {isHovered && (
        <span className="material-symbols-outlined text-primary">
          arrow_forward
        </span>
      )}
    </div>
  )
}
`,
  },
  {
    id: 'file-2',
    path: 'src/hooks/useDebounce.ts',
    name: 'useDebounce.ts',
    language: 'typescript',
    modified: true,
    encoding: 'UTF-8',
    content: `import { useState, useEffect } from 'react'

/**
 * Debounces a value by delaying updates until after a specified delay
 * @param value - The value to debounce
 * @param delay - Delay in milliseconds
 * @returns The debounced value
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    // Set up the timeout
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    // Clean up the timeout on value change or unmount
    return () => {
      clearTimeout(handler)
    }
  }, [value, delay])

  return debouncedValue
}

/**
 * Example usage:
 *
 * const [searchTerm, setSearchTerm] = useState('')
 * const debouncedSearch = useDebounce(searchTerm, 500)
 *
 * useEffect(() => {
 *   // This will only run 500ms after the user stops typing
 *   performSearch(debouncedSearch)
 * }, [debouncedSearch])
 */
`,
  },
  {
    id: 'file-3',
    path: 'src/utils/formatters.ts',
    name: 'formatters.ts',
    language: 'typescript',
    modified: false,
    encoding: 'UTF-8',
    content: `/**
 * Utility functions for formatting data
 */

/**
 * Formats a date to a human-readable string
 */
export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date

  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffSecs / 60)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSecs < 60) {
    return 'just now'
  } else if (diffMins < 60) {
    return \`\${diffMins} minute\${diffMins === 1 ? '' : 's'} ago\`
  } else if (diffHours < 24) {
    return \`\${diffHours} hour\${diffHours === 1 ? '' : 's'} ago\`
  } else if (diffDays < 7) {
    return \`\${diffDays} day\${diffDays === 1 ? '' : 's'} ago\`
  } else {
    return d.toLocaleDateString()
  }
}

/**
 * Formats a file size in bytes to a human-readable string
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes'

  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return \`\${Math.round(bytes / Math.pow(k, i) * 100) / 100} \${sizes[i]}\`
}

/**
 * Truncates a string to a specified length with ellipsis
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return str.slice(0, maxLength - 3) + '...'
}

/**
 * Formats a number with thousands separators
 */
export function formatNumber(num: number): string {
  return num.toLocaleString()
}
`,
  },
]
