// cspell:ignore Ghostty ghostty WINCH
// Deterministic stand-in for an alt-screen coding agent (Claude Code et al).
//
// CI runners have no agent installed and no credentials, so the remount spec
// drives this instead: it enters the alternate screen once, draws a
// bottom-anchored composer stack (separator / prompt / separator / hint) at
// the current grid size, and redraws on every SIGWINCH — the same contract
// the real agents follow and the same one the remount/resize regressions
// were diagnosed against. `VIMEFLOW_E2E_AGENT=claude` swaps the real agent
// back in for local runs.
//
// The hint line deliberately contains the marker the spec greps for
// ("manual mode") so the same helpers work against fixture and real agent.

const ESC = '\u001b'

const draw = () => {
  const rows = process.stdout.rows ?? 24
  const cols = process.stdout.columns ?? 80
  const separator = '─'.repeat(Math.max(4, cols - 2))
  const body = [
    `${ESC}[2J${ESC}[H`,
    `${ESC}[1;1HFIXTURE AGENT — alt-screen stand-in`,
    `${ESC}[2;1Hgrid ${cols}x${rows}`,
  ]

  if (rows >= 6) {
    body.push(
      `${ESC}[${rows - 3};1H${separator}`,
      `${ESC}[${rows - 2};1H❯ `,
      `${ESC}[${rows - 1};1H${separator}`,
      `${ESC}[${rows};1H⏵ fixture agent · manual mode`
    )
  }

  process.stdout.write(body.join(''))
}

// Enter the alternate screen exactly once and hide the cursor — the replay
// path's "re-enter unless the slice carries its own enter" branch depends on
// this being a single toggle that can scroll out of the ring.
process.stdout.write(`${ESC}[?1049h${ESC}[?25l`)
draw()

process.on('SIGWINCH', draw)
process.on('SIGTERM', () => {
  process.stdout.write(`${ESC}[?25h${ESC}[?1049l`)
  process.exit(0)
})

// Stay alive until the pane goes away.
process.stdin.resume()
