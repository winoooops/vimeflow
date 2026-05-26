import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type {
  Command,
  CommandPaletteState,
  UseCommandPaletteReturn,
} from '../registry/types'
import { fuzzyMatch } from '../registry/fuzzyMatch'
import { defaultCommands } from '../data/defaultCommands'
import { getAllLeaves, traverseNamespace } from '../registry/commandTree'
import { parseQuery } from '../registry/parseQuery'
import * as chordRegistry from '../chordRegistry'
import { listenCommandPaletteToggle } from '../../../lib/backend'

const LEADER_WINDOW_MS = 500

const isPaletteToggle = (event: KeyboardEvent): boolean =>
  event.ctrlKey && !event.metaKey && !event.altKey && event.key === ':'

const queryForLeaderFollowUp = (event: KeyboardEvent): string | null => {
  if (
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.key.length !== 1
  ) {
    return null
  }

  return `:${event.key}`
}

// Fully swallow a keydown: preventDefault + stopPropagation +
// stopImmediatePropagation. Applied to the palette toggle AND to Escape /
// leader follow-up keys, so the name describes the full-consume contract
// rather than any single call site (stopImmediatePropagation also blocks
// same-target capture-phase listeners in the Electron IPC path).
const fullyConsumeEvent = (event: KeyboardEvent): void => {
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
}

export const COMMAND_PALETTE_SHORTCUT_KEYS = ['Ctrl', ':'] as const

export const useCommandPalette = (
  commands: Command[] = defaultCommands
): UseCommandPaletteReturn => {
  const [state, setState] = useState<CommandPaletteState>({
    isOpen: false,
    query: ':',
    selectedIndex: 0,
    currentNamespace: null,
  })
  const leaderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const leaderActiveRef = useRef(false)

  const clearLeaderWindow = useCallback((): void => {
    if (leaderTimerRef.current) {
      clearTimeout(leaderTimerRef.current)
      leaderTimerRef.current = null
    }
    leaderActiveRef.current = false
  }, [])

  const startLeaderWindow = useCallback(
    (onExpire: () => void): void => {
      clearLeaderWindow()
      leaderActiveRef.current = true
      leaderTimerRef.current = setTimeout(() => {
        leaderActiveRef.current = false
        leaderTimerRef.current = null
        onExpire()
      }, LEADER_WINDOW_MS)
    },
    [clearLeaderWindow]
  )

  // Parse query into verb and args
  const parsedQuery = useMemo(() => parseQuery(state.query), [state.query])

  // Filter commands based on verb token only
  const filterCommands = useCallback(
    (
      commandVerb: string,
      namespace: Command | null,
      commandsList: Command[]
    ): Command[] => {
      const searchSpace = namespace
        ? (traverseNamespace(namespace) ?? [])
        : commandsList

      if (!commandVerb || commandVerb === ':') {
        return searchSpace
      }

      // Remove ':' prefix for matching
      const cleanVerb = commandVerb.startsWith(':')
        ? commandVerb.slice(1)
        : commandVerb

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
      filterCommands(parsedQuery.commandVerb, state.currentNamespace, commands),
    [parsedQuery.commandVerb, state.currentNamespace, commands, filterCommands]
  )

  // Clamp selectedIndex to valid range
  const clampedSelectedIndex = useMemo((): number => {
    if (filteredResults.length === 0) {
      return -1
    }

    return Math.min(state.selectedIndex, filteredResults.length - 1)
  }, [state.selectedIndex, filteredResults.length])

  const openWithQuery = useCallback((query: string): void => {
    setState((prev) => ({
      ...prev,
      isOpen: true,
      query,
      selectedIndex: 0,
      currentNamespace: null,
    }))
  }, [])

  const open = useCallback((): void => {
    openWithQuery(':')
  }, [openWithQuery])

  const close = useCallback((): void => {
    clearLeaderWindow()
    setState((prev) => ({
      ...prev,
      isOpen: false,
      query: ':',
      selectedIndex: 0,
      currentNamespace: null,
    }))
  }, [clearLeaderWindow])

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
      // commandVerb is what they're picking, not a verb to strip). We must
      // reconstruct the full post-`:` text so values containing spaces
      // (e.g. a filename like `my file.ts`) reach the handler intact.
      // Without this, `parseQuery` would split on the first space and
      // pass only the trailing token, silently truncating the input.
      const executionArgs =
        state.currentNamespace !== null
          ? (
              parsedQuery.commandVerb +
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
    parsedQuery.commandVerb,
    state.currentNamespace,
    close,
  ])

  // Refs let the once-registered capture-phase listener always read the latest handlers without re-attaching.
  const stateRef = useRef(state)

  const handlersRef = useRef({
    open,
    openWithQuery,
    close,
    navigateUp,
    navigateDown,
    executeSelected,
  })

  // useLayoutEffect (not useEffect) closes the commit→effect gap where a capture-phase keydown could read stale refs.
  useLayoutEffect(() => {
    stateRef.current = state
    handlersRef.current = {
      open,
      openWithQuery,
      close,
      navigateUp,
      navigateDown,
      executeSelected,
    }
  })

  // Global keyboard listener — registered once for the hook's lifetime.
  useEffect(() => {
    // Ctrl+: handling shared by the renderer keydown path and the Electron
    // before-input-event override. In the packaged app Electron owns the
    // Ctrl+: binding and consumes it before the renderer sees it, dispatching
    // an IPC toggle instead; this callback drives the same leader window so
    // the follow-up chord key (NOT intercepted) still reaches handleKeyDown
    // below and routes through chordRegistry / usePaneRenameChord.
    const handlePaletteShortcut = (): void => {
      if (leaderActiveRef.current) {
        clearLeaderWindow()
        handlersRef.current.open()

        return
      }

      if (stateRef.current.isOpen) {
        handlersRef.current.close()
      } else {
        startLeaderWindow(() => {
          handlersRef.current.open()
        })
      }
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (isPaletteToggle(event) && event.repeat) {
        fullyConsumeEvent(event)

        return
      }

      if (leaderActiveRef.current) {
        if (isPaletteToggle(event)) {
          fullyConsumeEvent(event)
          clearLeaderWindow()
          handlersRef.current.open()

          return
        }

        const consumed = chordRegistry.dispatch(event)
        clearLeaderWindow()

        if (consumed) {
          fullyConsumeEvent(event)
          handlersRef.current.close()

          return
        }

        if (event.key === 'Escape') {
          fullyConsumeEvent(event)

          return
        }

        fullyConsumeEvent(event)
        handlersRef.current.openWithQuery(queryForLeaderFollowUp(event) ?? ':')

        return
      }

      // Ctrl+: starts a short leader window. If no chord consumes the
      // follow-up key, the palette opens after the window or immediately on
      // the non-chord key.
      if (isPaletteToggle(event)) {
        fullyConsumeEvent(event)
        handlePaletteShortcut()

        return
      }

      // Handle keyboard navigation when palette is open
      if (stateRef.current.isOpen) {
        switch (event.key) {
          case 'Escape':
            event.preventDefault()
            handlersRef.current.close()
            break
          case 'ArrowUp':
            event.preventDefault()
            handlersRef.current.navigateUp()
            break
          case 'ArrowDown':
            event.preventDefault()
            handlersRef.current.navigateDown()
            break
          case 'Enter':
            event.preventDefault()
            handlersRef.current.executeSelected()
            break
          case 'Backspace':
            // Close on backspace when query is empty ':'
            if (stateRef.current.query === ':') {
              event.preventDefault()
              handlersRef.current.close()
            }
            break
        }
      }
    }

    const unlistenCommandPaletteToggle = listenCommandPaletteToggle(
      handlePaletteShortcut
    )

    document.addEventListener('keydown', handleKeyDown, { capture: true })

    return (): void => {
      unlistenCommandPaletteToggle()
      clearLeaderWindow()
      document.removeEventListener('keydown', handleKeyDown, { capture: true })
    }
  }, [clearLeaderWindow, startLeaderWindow])

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
