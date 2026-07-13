import type { ReactElement } from 'react'
import { GhostButton } from '@/features/settings/components/controls'
import { Icon } from '@/features/settings/components/Icon'
import type { ThemeJsonEditorMode } from '@/features/settings/components/ThemeJsonEditor'

interface ColorSchemeActionsProps {
  onSelectMode: (mode: ThemeJsonEditorMode) => void
}

export const ColorSchemeActions = ({
  onSelectMode,
}: ColorSchemeActionsProps): ReactElement => (
  <div className="mt-3.5 flex flex-wrap gap-2">
    <GhostButton onClick={(): void => onSelectMode('create')}>
      <Icon name="add" size={12} className="mr-1.5 align-middle" />
      New color scheme
    </GhostButton>
    <GhostButton onClick={(): void => onSelectMode('import')}>
      <Icon name="file_upload" size={12} className="mr-1.5 align-middle" />
      Import theme...
    </GhostButton>
    <GhostButton onClick={(): void => onSelectMode('export')}>
      <Icon name="download" size={12} className="mr-1.5 align-middle" />
      Export current
    </GhostButton>
    <GhostButton onClick={(): void => onSelectMode('edit')}>
      <Icon name="edit" size={12} className="mr-1.5 align-middle" />
      Edit current
    </GhostButton>
  </div>
)
