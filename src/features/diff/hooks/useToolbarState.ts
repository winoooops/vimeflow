/**
 * Maps persisted diff settings into Pierre render options.
 *
 * Panel should not need to know how toolbar controls map to Pierre's
 * worker pool or responsive width bands. This hook keeps those rules together:
 * it coerces split view when the pane is too narrow and syncs pool-owned
 * options before remounting Pierre.
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
import type { DiffsThemeNames, FileDiffOptions } from '@pierre/diffs'
import { useTheme } from '../../../theme'
import { enqueuePoolWrite } from '../services/workerPoolWrites'
import { DIFF_MIN_WIDTH_PX, SPLIT_MIN_WIDTH_PX } from '../components/toolbar'
import { type ReviewComment } from './useFeedbackBatch'
import { useSettings } from '../../settings/hooks/useSettings'
import {
  resolveDiffIndicators,
  resolveDiffLineDiffType,
  resolveDiffOverflow,
  resolveDiffStyle,
  resolveDiffTheme,
  type DiffLineDiffType,
  type DiffStyle,
} from '../diffViewSettings'

export type { DiffStyle } from '../diffViewSettings'

interface PoolRenderOptions {
  theme: DiffsThemeNames
  lineDiffType: DiffLineDiffType
}

export interface UseToolbarStateReturn {
  multiFileDiffOptions: FileDiffOptions<ReviewComment>
  renderKey: string
  renderSyncError: string | null
  setDiffPaneElement: (node: HTMLDivElement | null) => void
  tooNarrow: boolean
  effectiveDiffStyle: DiffStyle
  toggleDiffStyle: () => void
}

export const useToolbarState = (): UseToolbarStateReturn => {
  const { settings, update } = useSettings()
  const workspaceTheme = useTheme()
  const diffStyle = resolveDiffStyle(settings.diffViewStyle)
  const theme = resolveDiffTheme(settings.diffTheme, workspaceTheme.kind)
  const lineDiffType = resolveDiffLineDiffType(settings.diffLineDiffType)
  const diffIndicators = resolveDiffIndicators(settings.diffIndicators)
  const overflowOpt = resolveDiffOverflow(settings.diffOverflow)

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

  const toggleDiffStyle = useCallback((): void => {
    const next: DiffStyle = diffStyle === 'split' ? 'unified' : 'split'

    if (splitForced && next === 'unified') {
      return
    }

    update({ diffViewStyle: next })
  }, [diffStyle, splitForced, update])

  const multiFileDiffOptions = useMemo<FileDiffOptions<ReviewComment>>(
    () => ({
      diffStyle: effectiveDiffStyle,
      theme: renderedTheme,
      diffIndicators,
      lineDiffType: renderedLineDiffType,
      overflow: overflowOpt,
      disableLineNumbers: !settings.diffShowLineNumbers,
      disableBackground: !settings.diffBackgroundTint,
      disableFileHeader: !settings.diffFileHeader,
      stickyHeader: settings.diffStickyHeader,
      enableGutterUtility: true,
    }),
    [
      effectiveDiffStyle,
      renderedTheme,
      diffIndicators,
      renderedLineDiffType,
      overflowOpt,
      settings.diffShowLineNumbers,
      settings.diffBackgroundTint,
      settings.diffFileHeader,
      settings.diffStickyHeader,
    ]
  )

  return {
    multiFileDiffOptions,
    renderKey: `${renderedTheme}:${renderedLineDiffType}`,
    renderSyncError,
    setDiffPaneElement,
    tooNarrow,
    effectiveDiffStyle,
    toggleDiffStyle,
  }
}
