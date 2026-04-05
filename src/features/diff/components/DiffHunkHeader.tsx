import type { ReactElement } from 'react'

export interface DiffHunkHeaderProps {
  header: string
}

export const DiffHunkHeader = ({
  header,
}: DiffHunkHeaderProps): ReactElement => (
  <div className="sticky top-0 z-10 bg-surface-container-highest/50 px-4 py-2 font-code text-sm text-on-surface-variant">
    {header}
  </div>
)
