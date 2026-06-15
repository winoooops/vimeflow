import { useEffect, useMemo } from 'react'
import {
  planVisibleStatusRefreshes,
  refreshVisibleAgentStatusPanes,
} from '../utils/statusRefreshCoordinator'

interface UseAgentStatusHotLoadingOptions {
  activePtyId: string | null
  visiblePtyIds: readonly string[]
}

export const useAgentStatusHotLoading = ({
  activePtyId,
  visiblePtyIds,
}: UseAgentStatusHotLoadingOptions): void => {
  const plannedPtyIds = useMemo(
    () => planVisibleStatusRefreshes({ activePtyId, visiblePtyIds }),
    [activePtyId, visiblePtyIds]
  )

  const plannedPtyIdSignature = plannedPtyIds.join('\n')

  useEffect(() => {
    const nextVisiblePtyIds =
      plannedPtyIdSignature.length === 0
        ? []
        : plannedPtyIdSignature.split('\n')

    if (nextVisiblePtyIds.length === 0) {
      return
    }

    void refreshVisibleAgentStatusPanes({
      activePtyId,
      visiblePtyIds: nextVisiblePtyIds,
    })
  }, [activePtyId, plannedPtyIdSignature])
}
