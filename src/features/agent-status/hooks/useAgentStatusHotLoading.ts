import { useEffect, useMemo } from 'react'
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
}: UseAgentStatusHotLoadingOptions): void => {
  const refreshSignature = useMemo(
    () => JSON.stringify({ activePtyId, visiblePtyIds }),
    [activePtyId, visiblePtyIds]
  )

  useEffect(() => {
    const request = JSON.parse(refreshSignature) as VisibleStatusRefreshRequest

    if (request.visiblePtyIds.length === 0) {
      return
    }

    void refreshVisibleAgentStatusPanes(request)
  }, [refreshSignature])
}
