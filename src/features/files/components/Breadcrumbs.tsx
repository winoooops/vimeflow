import type { ReactElement } from 'react'

interface BreadcrumbsProps {
  segments: string[]
}

/**
 * Breadcrumbs component for displaying the current path in the file tree.
 */
export const Breadcrumbs = ({ segments }: BreadcrumbsProps): ReactElement => (
  <nav
    className="h-10 bg-surface-container-low/50 flex items-center px-6 gap-2"
    aria-label="File path breadcrumbs"
    role="navigation"
  >
    {segments.map((segment, index) => {
      const isLast = index === segments.length - 1

      return (
        <div key={segment} className="flex items-center gap-2">
          <span
            className={
              isLast
                ? 'text-on-surface font-semibold text-sm font-label'
                : 'text-on-surface-variant text-sm font-label'
            }
          >
            {segment}
          </span>
          {!isLast && (
            <span className="text-on-surface-variant text-sm font-label breadcrumb-separator">
              /
            </span>
          )}
        </div>
      )
    })}
  </nav>
)
