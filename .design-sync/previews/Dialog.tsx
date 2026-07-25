import { useEffect, type CSSProperties, type ReactElement } from 'react'
import { Button, Chip, Dialog } from 'vibm'

const noop = (): void => undefined

// The capture screenshots on `networkidle`, which fires before the dialog's
// framer-motion entrance (a spring that WAAPI-schedules the panel's opacity
// with a future startTime on the document timeline) completes — so the panel
// was photographed at opacity 0. Racing that timeline is flaky (only the first
// per-page shot won), so instead this deterministically FINISHES the entrance:
//   - a rAF pump calls getAnimations().finish() every frame, snapping any
//     running WAAPI animation (opacity/transform) to its end state the frame
//     after framer-motion commits it, and
//   - real, uncacheable fetches hold `networkidle` off (~2s) so the pump has
//     run — and finished the entrance — before the shot lands.
// Tick-counted, NOT Date.now()-gated: the harness freezes Date.now() via
// page.clock.setFixedTime, so a wall-clock deadline would never expire and
// would hang networkidle. Harmless elsewhere: bounded, swallowed errors,
// self-cancelling on unmount, and a no-op once the animation has ended.
const CAPTURE_PACING_TICKS = 12
const CAPTURE_PACING_FRAMES = 180

const useCapturePacing = (): void => {
  useEffect(() => {
    // Only the per-story shots need pacing. The grid-enumeration goto (no
    // ?story=) mounts every cell at once; running pacing there stalls its
    // `networkidle` and is wasted (that page is never screenshotted).
    let hasStory = false
    try {
      hasStory = new URLSearchParams(window.location.search).has('story')
    } catch {
      hasStory = false
    }
    if (!hasStory) {
      return undefined
    }

    // Lever 1 — hold `networkidle` off past the point where the entrance has
    // been committed and finished, with real (uncacheable) requests.
    let tick = 0
    const id = window.setInterval(() => {
      tick += 1
      if (tick > CAPTURE_PACING_TICKS) {
        window.clearInterval(id)
        return
      }
      void fetch(`/styles.css?ds-settle=${String(tick)}`).catch(() => undefined)
    }, 180)

    // Lever 2 — finish the entrance animation every frame so the shot always
    // lands on the settled end state, regardless of the timeline race.
    const doc = window.document as Document & {
      getAnimations?: () => Animation[]
    }
    let frames = 0
    let rafId = window.requestAnimationFrame(function pump(): void {
      doc.getAnimations?.().forEach((animation) => {
        try {
          animation.finish()
        } catch {
          /* not a finite-duration animation — ignore */
        }
      })
      frames += 1
      if (frames < CAPTURE_PACING_FRAMES) {
        rafId = window.requestAnimationFrame(pump)
      }
    })

    return () => {
      window.clearInterval(id)
      window.cancelAnimationFrame(rafId)
    }
  }, [])
}

// The dialog portals to document.body (true fixed overlay), so each cell lays
// down a full-viewport dark workspace behind it IN FLOW (margin cancels the
// harness body padding — a `position: fixed` backdrop would be hijacked by the
// single-story root's transform containing block).
const workspaceShell: CSSProperties = {
  margin: -24,
  height: 700,
  boxSizing: 'border-box',
  background: 'var(--color-surface)',
  color: 'var(--color-on-surface)',
  fontFamily: 'var(--font-body)',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: 16,
}

const WorkspaceBackdrop = (): ReactElement => {
  useCapturePacing()
  return <WorkspaceBackdropContent />
}

const WorkspaceBackdropContent = (): ReactElement => (
  <div style={workspaceShell} aria-hidden>
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <Chip label="kimi · ds-bundle" leadingIcon="smart_toy" />
      <Chip label="claude · vimeflow" leadingIcon="smart_toy" />
      <Chip label="main" leadingIcon="alt_route" />
    </div>
    <div
      style={{
        flex: 1,
        background: 'var(--color-surface-container)',
        borderRadius: 12,
        padding: 16,
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        lineHeight: 1.7,
        color: 'var(--color-on-surface-variant)',
      }}
    >
      <div>$ cargo test -p vimeflow-backend</div>
      <div>&nbsp;&nbsp;Compiling vimeflow-backend v0.1.0</div>
      <div>&nbsp;&nbsp;Running 42 tests · agent::adapter::kimi</div>
      <div>&nbsp;&nbsp;test transcript::resumed_session_tracking ... ok</div>
    </div>
  </div>
)

const dialogTitle: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-display)',
  fontSize: 15,
  fontWeight: 600,
  color: 'var(--color-on-surface)',
}

const dialogText: CSSProperties = {
  margin: 0,
  fontSize: 13,
  lineHeight: 1.6,
  color: 'var(--color-on-surface-variant)',
}

export const ConfirmCloseSession = (): ReactElement => (
  <>
    <WorkspaceBackdrop />
    <Dialog open onOpenChange={noop} size="sm" aria-label="Close session">
      <Dialog.Header>
        <h2 style={dialogTitle}>Close session?</h2>
      </Dialog.Header>
      <Dialog.Body>
        <p style={dialogText}>
          kimi is still running in pane 2. Closing the session ends its PTY and
          drops the resume handle for this worktree.
        </p>
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="ghost">Cancel</Button>
        <Button variant="danger">Close session</Button>
      </Dialog.Footer>
    </Dialog>
  </>
)

export const RenameSession = (): ReactElement => (
  <>
    <WorkspaceBackdrop />
    <Dialog
      open
      onOpenChange={noop}
      size="md"
      placement="top"
      aria-label="Rename session"
    >
      <Dialog.Header>
        <h2 style={dialogTitle}>Rename session</h2>
        <p style={{ ...dialogText, fontSize: 12, marginTop: 4 }}>
          Shown on the session tab and in the switcher.
        </p>
      </Dialog.Header>
      <Dialog.Body>
        <input
          aria-label="Session name"
          defaultValue="kimi · ds-bundle"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '8px 12px',
            borderRadius: 8,
            border: 'none',
            outline: 'none',
            background: 'var(--color-surface-container-high)',
            color: 'var(--color-on-surface)',
            fontFamily: 'var(--font-body)',
            fontSize: 13,
          }}
        />
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="ghost">Cancel</Button>
        <Button variant="primary">Rename</Button>
      </Dialog.Footer>
    </Dialog>
  </>
)

export const ThemeJsonEditor = (): ReactElement => (
  <>
    <WorkspaceBackdrop />
    <Dialog open onOpenChange={noop} size="lg" aria-label="Edit theme JSON">
      <Dialog.Header>
        <h2 style={dialogTitle}>Edit theme JSON</h2>
        <p style={{ ...dialogText, fontSize: 12, marginTop: 4 }}>
          Define the base palette. Interface, syntax, terminal, and agent colors
          are derived automatically.
        </p>
      </Dialog.Header>
      <Dialog.Body>
        <textarea
          aria-label="Theme JSON"
          readOnly
          rows={9}
          value={`{
  "name": "Catppuccin",
  "base": {
    "surface": "#1e1e2e",
    "onSurface": "#cdd6f4",
    "primary": "#89b4fa",
    "error": "#f38ba8"
  }
}`}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            resize: 'none',
            padding: 12,
            borderRadius: 8,
            border: 'none',
            outline: 'none',
            background: 'var(--color-surface-container)',
            color: 'var(--color-on-surface)',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            lineHeight: 1.6,
          }}
        />
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="ghost">Cancel</Button>
        <Button variant="primary">Apply theme</Button>
      </Dialog.Footer>
    </Dialog>
  </>
)
