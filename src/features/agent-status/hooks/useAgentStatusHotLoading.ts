import { useEffect, useMemo, useRef, useState } from 'react'
import {
  refreshVisibleAgentStatusPanes,
  type VisibleStatusRefreshRequest,
} from '../utils/statusRefreshCoordinator'

interface UseAgentStatusHotLoadingOptions {
  activePtyId: string | null
  visiblePtyIds: readonly string[]
}

export const useAgentStatusHotLoading = ({
  activePtyId,
  visiblePtyIds,
}: UseAgentStatusHotLoadingOptions): boolean => {
  const [isRefreshing, setIsRefreshing] = useState(false)
  const requestIdRef = useRef(0)

  const refreshSignature = useMemo(
    () => JSON.stringify({ activePtyId, visiblePtyIds }),
    [activePtyId, visiblePtyIds]
  )

  useEffect(() => {
    requestIdRef.current += 1
    const requestId = requestIdRef.current
    const request = JSON.parse(refreshSignature) as VisibleStatusRefreshRequest

    if (request.visiblePtyIds.length === 0) {
      setIsRefreshing(false)

      return
    }

    let cancelled = false

    setIsRefreshing(true)

    const refresh = async (): Promise<void> => {
      try {
        await refreshVisibleAgentStatusPanes(request)
      } catch {
        // A failed warm refresh should clear the subtle header affordance; the
        // live active-pane subscription remains the source of truth.
      } finally {
        if (!cancelled && requestIdRef.current === requestId) {
          setIsRefreshing(false)
        }
      }
    }

    void refresh()

    return (): void => {
      cancelled = true
    }
  }, [refreshSignature])

  return isRefreshing
}
