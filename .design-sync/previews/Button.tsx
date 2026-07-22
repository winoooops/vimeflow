import { Button } from 'vibm'

// The app mounts everything on the dark Lens surface (body bg-surface); the
// preview card chrome is white, so each cell re-creates that surface with
// token vars (inline styles — utility classes not used by the app are purged
// from the compiled CSS).
const surface = {
  background: 'var(--color-surface)',
  color: 'var(--color-on-surface)',
  padding: 24,
  borderRadius: 12,
  display: 'flex',
  flexWrap: 'wrap' as const,
  alignItems: 'center',
  gap: 16,
}

export const Variants = () => (
  <div style={surface}>
    <Button variant="primary">New session</Button>
    <Button variant="flat-primary">Commit</Button>
    <Button variant="default">Open file</Button>
    <Button variant="toolbar">Stage all</Button>
    <Button variant="ghost">Dismiss</Button>
    <Button variant="danger">Discard changes</Button>
  </div>
)

export const Sizes = () => (
  <div style={surface}>
    <Button variant="default" size="sm">
      Small
    </Button>
    <Button variant="default" size="md">
      Medium
    </Button>
    <Button variant="default" size="lg">
      Large
    </Button>
  </div>
)

export const WithIcon = () => (
  <div style={surface}>
    <Button variant="primary" leadingIcon="add">
      New session
    </Button>
    <Button variant="default" leadingIcon="search">
      Search files
    </Button>
    <Button variant="ghost" leadingIcon="history">
      Recent
    </Button>
  </div>
)

export const Disabled = () => (
  <div style={surface}>
    <Button variant="primary" disabled>
      New session
    </Button>
    <Button variant="default" disabled>
      Open file
    </Button>
  </div>
)
