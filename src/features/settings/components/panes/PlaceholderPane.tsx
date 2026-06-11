import type { ReactElement } from 'react'
import type { PlaceholderPaneProps } from '../../types'
import { Icon } from '../Icon'
import { PaneTitle } from '../controls'

export const PlaceholderPane = ({
  section,
}: PlaceholderPaneProps): ReactElement => (
  <>
    <PaneTitle title={section.label} sub="Coming soon" />
    <div className="mt-3 rounded-[10px] border border-dashed border-outline-variant/40 p-10 text-center">
      <Icon
        name={section.icon}
        size={32}
        className="mx-auto mb-3 text-primary-container/40"
      />
      <div className="mb-1.5 font-display text-sm text-on-surface">
        {section.label} settings haven&apos;t been wired yet.
      </div>
      <div className="font-body text-xs text-on-surface-muted">
        This pane will host the {section.label.toLowerCase()} configuration in a
        future build.
      </div>
    </div>
  </>
)
