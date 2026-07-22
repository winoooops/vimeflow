import { useState, type ReactElement } from 'react'
import { Button, Chip, Popover } from 'vibm'

// Dark Lens surface for the white preview card (inline token vars — see NOTES).
const surface = {
  background: 'var(--color-surface)',
  color: 'var(--color-on-surface)',
  fontFamily: 'var(--font-body)',
  padding: 24,
  borderRadius: 12,
  display: 'flex',
  flexWrap: 'wrap' as const,
  gap: 16,
}

const panelTitle = {
  margin: 0,
  fontFamily: 'var(--font-display)',
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--color-on-surface)',
}

const panelDetail = {
  margin: 0,
  fontSize: 11,
  lineHeight: 1.5,
  color: 'var(--color-on-surface-variant)',
}

// Popover is controlled (anchor element + open) — each cell captures its
// trigger element via callback ref and opens once the anchor exists.
export const RequestReview = (): ReactElement => {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <div style={{ ...surface, minHeight: 300, alignItems: 'flex-start' }}>
      <Button ref={setAnchor} variant="toolbar" leadingIcon="rate_review">
        Request review
      </Button>
      <Popover
        anchor={anchor}
        open={anchor !== null}
        onOpenChange={(): void => undefined}
        placement="bottom-start"
        width={340}
        aria-label="Request review"
      >
        <div style={{ padding: 16, display: 'grid', gap: 12 }}>
          <div>
            <h3 style={panelTitle}>Request review</h3>
            <p style={{ ...panelDetail, marginTop: 4 }}>
              crates/backend/src/agent/adapter/kimi/transcript.rs · unstaged
            </p>
          </div>
          <div
            style={{
              display: 'flex',
              gap: 8,
              justifyContent: 'flex-end',
              alignItems: 'center',
            }}
          >
            <Button variant="ghost" size="sm">
              Copy
            </Button>
            <Button variant="primary" size="sm">
              Delegate to kimi
            </Button>
          </div>
        </div>
      </Popover>
    </div>
  )
}

export const ConfirmDiscard = (): ReactElement => {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <div
      style={{
        ...surface,
        minHeight: 280,
        alignItems: 'flex-start',
        justifyContent: 'center',
      }}
    >
      <Button ref={setAnchor} variant="ghost" leadingIcon="undo">
        Discard hunk
      </Button>
      <Popover
        anchor={anchor}
        open={anchor !== null}
        onOpenChange={(): void => undefined}
        placement="bottom"
        width={300}
        aria-label="Discard changes"
      >
        <div style={{ padding: 16, display: 'grid', gap: 12 }}>
          <div>
            <h3 style={panelTitle}>Discard changes?</h3>
            <p style={{ ...panelDetail, marginTop: 4 }}>
              Drops 2 unstaged hunks in locator.rs. This cannot be undone.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" size="sm">
              Cancel
            </Button>
            <Button variant="danger" size="sm">
              Discard
            </Button>
          </div>
        </div>
      </Popover>
    </div>
  )
}

export const SessionHandoff = (): ReactElement => {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const handoffRow = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    padding: '6px 8px',
    borderRadius: 8,
    border: 'none',
    background: 'transparent',
    color: 'var(--color-on-surface)',
    fontFamily: 'var(--font-body)',
    fontSize: 12,
    textAlign: 'left' as const,
    cursor: 'pointer',
  }
  return (
    <div style={{ ...surface, minHeight: 260, alignItems: 'flex-start' }}>
      <span ref={setAnchor} style={{ display: 'inline-flex' }}>
        <Chip label="kimi · ds-bundle" leadingIcon="smart_toy" />
      </span>
      <Popover
        anchor={anchor}
        open={anchor !== null}
        onOpenChange={(): void => undefined}
        placement="right-start"
        width={260}
        aria-label="Hand off session"
      >
        <div style={{ padding: 12, display: 'grid', gap: 6 }}>
          <p
            style={{
              ...panelDetail,
              textTransform: 'uppercase' as const,
              letterSpacing: '0.05em',
              fontSize: 10,
              fontWeight: 700,
              padding: '0 8px',
            }}
          >
            Hand off to
          </p>
          <button type="button" style={handoffRow}>
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 16, color: 'var(--color-primary)' }}
              aria-hidden
            >
              swap_horiz
            </span>
            claude · review the staged diff
          </button>
          <button type="button" style={handoffRow}>
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 16, color: 'var(--color-primary)' }}
              aria-hidden
            >
              swap_horiz
            </span>
            codex · verify the fix compiles
          </button>
        </div>
      </Popover>
    </div>
  )
}
