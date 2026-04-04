import { useCallback, useEffect, useState } from 'react'
import type { Command, CommandPaletteState } from '../types'
import { fuzzyMatch } from '../registry/fuzzyMatch'
import { defaultCommands } from '../data/defaultCommands'
import { getAllLeaves, traverseNamespace } from '../registry/commandTree'

interface UseCommandPaletteReturn {
  state: CommandPaletteState
  open: () => void
  close: () => void
  setQuery: (query: string) => void
  selectIndex: (index: number) => void
  executeSelected: () => void
  navigateUp: () => void
  navigateDown: () => void
}

const isInputElement = (element: Element | null): boolean => {
  if (!element) {
    return false
  }

  const tagName = element.tagName.toLowerCase()
  if (tagName === 'input' || tagName === 'textarea') {
    return true
  }

  // Check for contenteditable
  if (element.hasAttribute('contenteditable')) {
    const value = element.getAttribute('contenteditable')

    return value === 'true' || value === ''
  }

  return false
}

export const useCommandPalette = (): UseCommandPaletteReturn => {
  const [state, setState] = useState<CommandPaletteState>({
    isOpen: false,
    query: ':',
    selectedIndex: 0,
    currentNamespace: null,
    filteredResults: [],
  })

  // Filter commands based on query
  const filterCommands = useCallback(
    (query: string, namespace: Command | null): Command[] => {
      const searchSpace = namespace
        ? (traverseNamespace(namespace) ?? [])
        : defaultCommands

      if (!query || query === ':') {
        return searchSpace
      }

      // Remove ':' prefix for matching
      const cleanQuery = query.startsWith(':') ? query.slice(1) : query

      // Get all searchable commands (namespaces + leaves)
      const allCommands = [...searchSpace]
      const leaves = getAllLeaves(searchSpace)
      allCommands.push(...leaves)

      // Score and filter
      const scored = allCommands
        .map((cmd) => {
          const score = cmd.match
            ? cmd.match(cleanQuery)
            : fuzzyMatch(cleanQuery, cmd.label.replace(':', ''))

          return { cmd, score }
        })
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .map(({ cmd }) => cmd)

      // Deduplicate by id
      const seen = new Set<string>()

      return scored.filter((cmd) => {
        if (seen.has(cmd.id)) {
          return false
        }
        seen.add(cmd.id)

        return true
      })
    },
    []
  )

  const open = useCallback((): void => {
    setState((prev) => ({
      ...prev,
      isOpen: true,
      query: ':',
      selectedIndex: 0,
      currentNamespace: null,
      filteredResults: filterCommands(':', null),
    }))
  }, [filterCommands])

  const close = useCallback((): void => {
    setState((prev) => ({
      ...prev,
      isOpen: false,
      query: ':',
      selectedIndex: 0,
      currentNamespace: null,
      filteredResults: [],
    }))
  }, [])

  const setQuery = useCallback(
    (query: string): void => {
      setState((prev) => {
        const filteredResults = filterCommands(query, prev.currentNamespace)

        return {
          ...prev,
          query,
          selectedIndex: 0,
          filteredResults,
        }
      })
    },
    [filterCommands]
  )

  const selectIndex = useCallback((index: number): void => {
    setState((prev) => ({
      ...prev,
      selectedIndex: index,
    }))
  }, [])

  const navigateUp = useCallback((): void => {
    setState((prev) => {
      const newIndex =
        prev.selectedIndex <= 0
          ? prev.filteredResults.length - 1
          : prev.selectedIndex - 1

      return {
        ...prev,
        selectedIndex: newIndex,
      }
    })
  }, [])

  const navigateDown = useCallback((): void => {
    setState((prev) => {
      const newIndex =
        prev.selectedIndex >= prev.filteredResults.length - 1
          ? 0
          : prev.selectedIndex + 1

      return {
        ...prev,
        selectedIndex: newIndex,
      }
    })
  }, [])

  const executeSelected = useCallback((): void => {
    if (
      state.selectedIndex < 0 ||
      state.selectedIndex >= state.filteredResults.length
    ) {
      return
    }

    const selected = state.filteredResults[state.selectedIndex]

    // If it's a namespace, drill into it
    if (selected.children && selected.children.length > 0) {
      setState((prev) => ({
        ...prev,
        currentNamespace: selected,
        query: ':',
        selectedIndex: 0,
        filteredResults: filterCommands(':', selected),
      }))

      return
    }

    // If it's a leaf, execute it
    if (selected.execute) {
      const args = state.query.startsWith(':')
        ? state.query.slice(1)
        : state.query
      selected.execute(args)
      close()
    }
  }, [
    state.filteredResults,
    state.selectedIndex,
    state.query,
    filterCommands,
    close,
  ])

  // Global keyboard listener
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      // Check if an input element is focused
      if (isInputElement(document.activeElement)) {
        return
      }

      // Open palette on ':'
      if (event.key === ':' && !state.isOpen) {
        event.preventDefault()
        open()

        return
      }

      // Handle keyboard navigation when palette is open
      if (state.isOpen) {
        switch (event.key) {
          case 'Escape':
            event.preventDefault()
            close()
            break
          case 'ArrowUp':
            event.preventDefault()
            navigateUp()
            break
          case 'ArrowDown':
            event.preventDefault()
            navigateDown()
            break
          case 'Enter':
            event.preventDefault()
            executeSelected()
            break
          case 'Backspace':
            // Close on backspace when query is empty ':'
            if (state.query === ':') {
              event.preventDefault()
              close()
            }
            break
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return (): void => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [
    state.isOpen,
    state.query,
    open,
    close,
    navigateUp,
    navigateDown,
    executeSelected,
  ])

  return {
    state,
    open,
    close,
    setQuery,
    selectIndex,
    executeSelected,
    navigateUp,
    navigateDown,
  }
}
