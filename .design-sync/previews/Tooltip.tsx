import { useEffect, useRef, type ReactElement } from 'react'
import { Button, Chip, IconButton, Tooltip } from 'vibm'

// The Lens is dark-first; the preview card chrome is white, so each cell
// re-creates the app surface with token vars via inline styles.
const surface = {
  background: 'var(--color-surface)',
  color: 'var(--color-on-surface)',
  fontFamily: 'var(--font-body)',
  padding: 24,
  borderRadius: 12,
  display: 'flex',
  flexWrap: 'wrap' as const,
  alignItems: 'center',
  gap: 16,
}

// Tooltip has no controlled `open` prop (hover/focus only, per source), so the
// preview opens it by dispatching hover events + focus on the trigger after
// mount. delayMs={0} makes the open immediate for the capture.
const OpenOnMount = ({
  children,
}: {
  children: ReactElement
}): ReactElement => {
  const ref = useRef<HTMLSpanElement | null>(null)
  useEffect(() => {
    const timer = setTimeout(() => {
      const trigger =
        ref.current?.querySelector<HTMLElement>('button, [tabindex]')
      if (trigger) {
        trigger.dispatchEvent(
          new MouseEvent('mouseover', { bubbles: true, cancelable: true })
        )
        trigger.dispatchEvent(
          new MouseEvent('mouseenter', { cancelable: true })
        )
        trigger.focus()
      }
    }, 80)
    return () => clearTimeout(timer)
  }, [])
  return (
    <span ref={ref} style={{ display: 'inline-flex' }}>
      {children}
    </span>
  )
}

export const Label = (): ReactElement => (
  <div style={{ ...surface, minHeight: 170, justifyContent: 'center' }}>
    <OpenOnMount>
      <Tooltip content="Close pane" placement="top" delayMs={0}>
        <IconButton icon="close" label="Close pane" showTooltip={false} />
      </Tooltip>
    </OpenOnMount>
  </div>
)

export const WithShortcut = (): ReactElement => (
  <div style={{ ...surface, minHeight: 170, justifyContent: 'center' }}>
    <OpenOnMount>
      <Tooltip
        content="Toggle terminal dock"
        shortcut={['Mod', 'J']}
        placement="top"
        delayMs={0}
      >
        <IconButton icon="terminal" label="Terminal" showTooltip={false} />
      </Tooltip>
    </OpenOnMount>
  </div>
)

export const PlacementRight = (): ReactElement => (
  <div style={{ ...surface, minHeight: 140, paddingRight: 280 }}>
    <OpenOnMount>
      <Tooltip
        content="kimi · implementing VIM-362 · 12m elapsed"
        placement="right"
        delayMs={0}
      >
        <Chip label="kimi/ds-bundle" leadingIcon="smart_toy" tabIndex={0} />
      </Tooltip>
    </OpenOnMount>
  </div>
)

export const MaxWidthClamp = (): ReactElement => (
  <div
    style={{
      ...surface,
      minHeight: 210,
      justifyContent: 'center',
      alignItems: 'flex-start',
    }}
  >
    <OpenOnMount>
      <Tooltip
        content="Restores the resumed Kimi session from the newest rollout transcript recorded for this worktree."
        placement="bottom"
        maxWidth={210}
        delayMs={0}
      >
        <Button variant="ghost" leadingIcon="history">
          Resume details
        </Button>
      </Tooltip>
    </OpenOnMount>
  </div>
)
