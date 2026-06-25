import { Fragment, type ReactElement } from 'react'
import { pathParts } from '../../utils/sessionPaths'

interface PathCrumbProps {
  path: string
}

// Renders a path as colored, separator-joined segments. Last segment = primary;
// intermediate = muted. Uses pathParts so Windows/UNC paths render too.
export const PathCrumb = ({ path }: PathCrumbProps): ReactElement => {
  const rawParts = pathParts(path)
  const parts = rawParts.length > 0 ? rawParts : [path.length > 0 ? path : '/']

  return (
    <span className="truncate font-mono text-[12.5px]">
      {parts.map((part, i) => {
        const last = i === parts.length - 1

        return (
          <Fragment key={`${part}-${i}`}>
            {i > 0 && <span className="text-on-surface-muted">/</span>}
            <span className={last ? 'font-semibold text-primary' : 'text-on-surface-muted'}>
              {part}
            </span>
          </Fragment>
        )
      })}
    </span>
  )
}
