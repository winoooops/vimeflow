import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  Command,
  CommandPaletteState,
  UseCommandPaletteReturn,
} from '../registry/types'
import { fuzzyMatch } from '../registry/fuzzyMatch'
import { defaultCommands } from '../data/defaultCommands'
import { getAllLeaves, traverseNamespace } from '../registry/commandTree'
import { parseQuery } from '../registry/parseQuery'

const isPaletteToggle = (event: KeyboardEvent): boolean =>
  event.ctrlKey && !event.metaKey && !event.altKey && event.key === ':'

export const useCommandPalette = (
  commands: Command[] = defaultCommands
): UseCommandPaletteReturn => {
  const [state, setState] = useState<CommandPaletteState>({
    isOpen: false,
    query: ':',
    selectedIndex: 0,
    currentNamespace: null,
  })

  // Parse query into verb and args
  const parsedQuery = useMemo(() => parseQuery(state.query), [state.query])

  // Filter commands based on verb token only
  const filterCommands = useCallback(
    (
      verbToken: string,
      namespace: Command | null,
      commandsList: Command[]
    ): Command[] => {
      const searchSpace = namespace
        ? (traverseNamespace(namespace) ?? [])
        : commandsList

      if (!verbToken || verbToken === ':') {
        return searchSpace
      }

      // Remove ':' prefix for matching
      const cleanVerb = verbToken.startsWith(':')
        ? verbToken.slice(1)
        : verbToken

      // Get all searchable commands (namespaces + leaves)
      const allCommands = [...searchSpace]
      const leaves = getAllLeaves(searchSpace)
      allCommands.push(...leaves)

      // Score and filter
      const scored = allCommands
        .map((cmd) => {
          const score = cmd.match
            ? cmd.match(cleanVerb)
            : fuzzyMatch(cleanVerb, cmd.label.replace(':', ''))

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

  // Derive filtered results from verb token
  const filteredResults = useMemo(
    () =>
      filterCommands(parsedQuery.verbToken, state.currentNamespace, commands),
    [parsedQuery.verbToken, state.currentNamespace, commands, filterCommands]
  )

  // Clamp selectedIndex to valid range
  const clampedSelectedIndex = useMemo((): number => {
    if (filteredResults.length === 0) {
      return -1
    }

    return Math.min(state.selectedIndex, filteredResults.length - 1)
  }, [state.selectedIndex, filteredResults.length])

  const open = useCallback((): void => {
    setState((prev) => ({
      ...prev,
      isOpen: true,
      query: ':',
      selectedIndex: 0,
      currentNamespace: null,
    }))
  }, [])

  const close = useCallback((): void => {
    setState((prev) => ({
      ...prev,
      isOpen: false,
      query: ':',
      selectedIndex: 0,
      currentNamespace: null,
    }))
  }, [])

  const setQuery = useCallback((query: string): void => {
    setState((prev) => ({
      ...prev,
      query,
      selectedIndex: 0,
    }))
  }, [])

  const selectIndex = useCallback((index: number): void => {
    setState((prev) => ({
      ...prev,
      selectedIndex: index,
    }))
  }, [])

  const navigateUp = useCallback((): void => {
    if (filteredResults.length === 0) {
      return
    }

    setState((prev) => {
      const currentClamped = Math.min(
        prev.selectedIndex,
        filteredResults.length - 1
      )

      const newIndex =
        currentClamped <= 0 ? filteredResults.length - 1 : currentClamped - 1

      return {
        ...prev,
        selectedIndex: newIndex,
      }
    })
  }, [filteredResults])

  const navigateDown = useCallback((): void => {
    if (filteredResults.length === 0) {
      return
    }

    setState((prev) => {
      const currentClamped = Math.min(
        prev.selectedIndex,
        filteredResults.length - 1
      )

      const newIndex =
        currentClamped >= filteredResults.length - 1 ? 0 : currentClamped + 1

      return {
        ...prev,
        selectedIndex: newIndex,
      }
    })
  }, [filteredResults])

  const executeSelected = useCallback((): void => {
    if (clampedSelectedIndex < 0) {
      return
    }

    const selected = filteredResults[clampedSelectedIndex]

    // If it's a namespace, drill into it
    if (selected.children && selected.children.length > 0) {
      setState((prev) => ({
        ...prev,
        currentNamespace: selected,
        query: ':',
        selectedIndex: 0,
      }))

      return
    }

    // If it's a leaf, execute it
    if (selected.execute) {
      // Inside a namespace, the user's typed input is the value (the
      // verbToken is what they're picking, not a verb to strip). We must
      // reconstruct the full post-`:` text so values containing spaces
      // (e.g. a filename like `my file.ts`) reach the handler intact.
      // Without this, `parseQuery` would split on the first space and
      // pass only the trailing token, silently truncating the input.
      const executionArgs =
        state.currentNamespace !== null
          ? (
              parsedQuery.verbToken +
              (parsedQuery.args.length > 0 ? ' ' + parsedQuery.args : '')
            ).replace(/^:/, '')
          : parsedQuery.args

      selected.execute(executionArgs)
      close()
    }
  }, [
    clampedSelectedIndex,
    filteredResults,
    parsedQuery.args,
    parsedQuery.verbToken,
    state.currentNamespace,
    close,
  ])

  // Global keyboard listener
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      // Toggle palette on Ctrl+: (capture-phase listener)
      if (isPaletteToggle(event)) {
        // Suppress repeat events
        if (event.repeat) {
          event.preventDefault()
          event.stopPropagation()

          return
        }

        event.preventDefault()
        event.stopPropagation()

        if (state.isOpen) {
          close()
        } else {
          open()
        }

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

    document.addEventListener('keydown', handleKeyDown, { capture: true })

    return (): void => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true })
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
    filteredResults,
    clampedSelectedIndex,
    open,
    close,
    setQuery,
    selectIndex,
    executeSelected,
    navigateUp,
    navigateDown,
  }
}
