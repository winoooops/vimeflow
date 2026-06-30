/**
 * Owns diff-toolbar settings and the Pierre render options derived from them.
 *
 * Panel should not need to know how toolbar controls map to Pierre's
 * worker pool or responsive width bands. This hook keeps those rules together:
 * it stores the controlled toolbar values, coerces split view when the pane is
 * too narrow, syncs pool-owned options before remounting Pierre, and exposes the
 * exact props needed by DiffChipToolbar and MultiFileDiff.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useWorkerPool } from '@pierre/diffs/react'
import type {
  BaseDiffOptions,
  DiffsThemeNames,
  FileDiffOptions,
} from '@pierre/diffs'
import { useTheme } from '../../../theme'
import { pierreThemeForKind } from '../pierreTheme'
import { enqueuePoolWrite } from '../services/workerPoolWrites'
import {
  DIFF_MIN_WIDTH_PX,
  SPLIT_MIN_WIDTH_PX,
  type DiffChipToolbarProps,
} from '../components/toolbar'
import { type ReviewComment } from './useFeedbackBatch'

export type DiffStyle = NonNullable<BaseDiffOptions['diffStyle']>
type DiffIndicators = NonNullable<BaseDiffOptions['diffIndicators']>
type Overflow = NonNullable<BaseDiffOptions['overflow']>
type LineDiffType = NonNullable<BaseDiffOptions['lineDiffType']>

export type DiffToolbarSettingsProps = Pick<
  DiffChipToolbarProps,
  | 'diffStyle'
  | 'onDiffStyleChange'
  | 'theme'
  | 'onThemeChange'
  | 'lineDiffType'
  | 'onLineDiffTypeChange'
  | 'diffIndicators'
  | 'onDiffIndicatorsChange'
  | 'overflow'
  | 'onOverflowChange'
  | 'disableLineNumbers'
  | 'onDisableLineNumbersChange'
  | 'disableBackground'
  | 'onDisableBackgroundChange'
  | 'disableFileHeader'
  | 'onDisableFileHeaderChange'
  | 'stickyHeader'
  | 'onStickyHeaderChange'
>

interface PoolRenderOptions {
  theme: DiffsThemeNames
  lineDiffType: LineDiffType
}

export interface UseToolbarStateReturn {
  toolbarSettingsProps: DiffToolbarSettingsProps
  multiFileDiffOptions: FileDiffOptions<ReviewComment>
  renderKey: string
  renderSyncError: string | null
  setDiffPaneElement: (node: HTMLDivElement | null) => void
  tooNarrow: boolean
  effectiveDiffStyle: DiffStyle
  toggleDiffStyle: () => void
}

export const useToolbarState = (): UseToolbarStateReturn => {
  const [diffStyle, setDiffStyle] = useState<DiffStyle>('split')

  const workspaceTheme = useTheme()

  const [theme, setTheme] = useState<DiffsThemeNames>(() =>
    pierreThemeForKind(workspaceTheme.kind)
  )

  // Workspace theme switch resets the diff theme to the mapped default,
  // overriding any session-level dropdown choice.
  useEffect(() => {
    setTheme(pierreThemeForKind(workspaceTheme.kind))
  }, [workspaceTheme.kind])

  const [lineDiffType, setLineDiffType] = useState<LineDiffType>('word')

  const [diffIndicators, setDiffIndicators] =
    useState<DiffIndicators>('classic')

  const [overflowOpt, setOverflowOpt] = useState<Overflow>('scroll')
  const [disableLineNumbers, setDisableLineNumbers] = useState(false)
  const [disableBackground, setDisableBackground] = useState(false)
  const [disableFileHeader, setDisableFileHeader] = useState(false)
  const [stickyHeader, setStickyHeader] = useState(true)

  // Pool-owned render options are committed only after the worker pool accepts
  // them. Pierre reads theme and lineDiffType from the pool, not just from props.
  const [syncedRenderOptions, setSyncedRenderOptions] =
    useState<PoolRenderOptions>({ theme, lineDiffType })
  const syncedRenderOptionsRef = useRef<PoolRenderOptions>(syncedRenderOptions)

  const [renderSyncError, setRenderSyncErrorState] = useState<string | null>(
    null
  )
  const renderSyncErrorRef = useRef<string | null>(null)

  const setRenderSyncError = useCallback((message: string | null): void => {
    if (renderSyncErrorRef.current === message) {
      return
    }

    renderSyncErrorRef.current = message
    setRenderSyncErrorState(message)
  }, [])

  const commitSyncedRenderOptions = useCallback(
    (next: PoolRenderOptions): void => {
      const prev = syncedRenderOptionsRef.current
      if (
        prev.theme === next.theme &&
        prev.lineDiffType === next.lineDiffType
      ) {
        return
      }

      syncedRenderOptionsRef.current = next
      setSyncedRenderOptions(next)
    },
    []
  )

  const [diffPaneElement, setDiffPaneElement] = useState<HTMLDivElement | null>(
    null
  )
  const [paneWidth, setPaneWidth] = useState(0)

  useLayoutEffect(() => {
    if (!diffPaneElement) {
      return
    }

    const observer = new ResizeObserver((entries) => {
      setPaneWidth(entries[0].contentRect.width)
    })
    observer.observe(diffPaneElement)

    return (): void => observer.disconnect()
  }, [diffPaneElement])

  const workerPool = useWorkerPool()

  useEffect(() => {
    const next: PoolRenderOptions = { theme, lineDiffType }

    if (!workerPool) {
      commitSyncedRenderOptions(next)

      return
    }

    let cancelled = false

    const run = async (): Promise<void> => {
      try {
        await enqueuePoolWrite(workerPool, next, () => cancelled)

        if (!cancelled) {
          setRenderSyncError(null)
          commitSyncedRenderOptions(next)
        }
      } catch (err) {
        if (!cancelled) {
          setRenderSyncError(err instanceof Error ? err.message : String(err))
        }
      }
    }

    void run()

    return (): void => {
      cancelled = true
    }
  }, [
    commitSyncedRenderOptions,
    setRenderSyncError,
    workerPool,
    theme,
    lineDiffType,
  ])

  const renderedTheme = workerPool ? syncedRenderOptions.theme : theme

  const renderedLineDiffType = workerPool
    ? syncedRenderOptions.lineDiffType
    : lineDiffType

  const hasMeasuredPane = paneWidth > 0

  const splitForced =
    hasMeasuredPane && diffStyle === 'split' && paneWidth < SPLIT_MIN_WIDTH_PX
  const effectiveDiffStyle: DiffStyle = splitForced ? 'unified' : diffStyle
  const tooNarrow = hasMeasuredPane && paneWidth < DIFF_MIN_WIDTH_PX

  const handleDiffStyleChange = useCallback(
    (next: DiffStyle): void => {
      if (splitForced && next === 'unified') {
        return
      }

      setDiffStyle(next)
    },
    [splitForced]
  )

  const toggleDiffStyle = useCallback((): void => {
    handleDiffStyleChange(diffStyle === 'split' ? 'unified' : 'split')
  }, [diffStyle, handleDiffStyleChange])

  const toolbarSettingsProps = useMemo<DiffToolbarSettingsProps>(
    () => ({
      diffStyle: effectiveDiffStyle,
      onDiffStyleChange: handleDiffStyleChange,
      theme,
      onThemeChange: setTheme,
      lineDiffType,
      onLineDiffTypeChange: setLineDiffType,
      diffIndicators,
      onDiffIndicatorsChange: setDiffIndicators,
      overflow: overflowOpt,
      onOverflowChange: setOverflowOpt,
      disableLineNumbers,
      onDisableLineNumbersChange: setDisableLineNumbers,
      disableBackground,
      onDisableBackgroundChange: setDisableBackground,
      disableFileHeader,
      onDisableFileHeaderChange: setDisableFileHeader,
      stickyHeader,
      onStickyHeaderChange: setStickyHeader,
    }),
    [
      effectiveDiffStyle,
      handleDiffStyleChange,
      theme,
      lineDiffType,
      diffIndicators,
      overflowOpt,
      disableLineNumbers,
      disableBackground,
      disableFileHeader,
      stickyHeader,
    ]
  )

  const multiFileDiffOptions = useMemo<FileDiffOptions<ReviewComment>>(
    () => ({
      diffStyle: effectiveDiffStyle,
      theme: renderedTheme,
      diffIndicators,
      lineDiffType: renderedLineDiffType,
      overflow: overflowOpt,
      disableLineNumbers,
      disableBackground,
      disableFileHeader,
      stickyHeader,
      enableGutterUtility: true,
    }),
    [
      effectiveDiffStyle,
      renderedTheme,
      diffIndicators,
      renderedLineDiffType,
      overflowOpt,
      disableLineNumbers,
      disableBackground,
      disableFileHeader,
      stickyHeader,
    ]
  )

  return {
    toolbarSettingsProps,
    multiFileDiffOptions,
    renderKey: `${renderedTheme}:${renderedLineDiffType}`,
    renderSyncError,
    setDiffPaneElement,
    tooNarrow,
    effectiveDiffStyle,
    toggleDiffStyle,
  }
}
