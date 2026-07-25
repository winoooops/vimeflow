import { ProgressBar } from 'vibm'

// Dark Lens surface wrapper — the preview card chrome is white, so each cell
// re-creates the app surface with token vars (inline styles; unused utility
// classes are purged from the compiled CSS).
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

const caption = {
  color: 'var(--color-on-surface-muted)',
  font: '12px Inter',
}

const bar = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 6,
  width: 220,
}

// The default track is surface-colored (invisible on the surface wrapper), so
// give it the recessed tint the app uses (TokenCache does exactly this).
const track = {
  background:
    'color-mix(in srgb, var(--color-outline-variant) 25%, transparent)',
}

export const Values = () => (
  <div style={surface}>
    <div style={bar}>
      <span style={caption}>context 0%</span>
      <ProgressBar label="Context window usage" value={0} style={track} />
    </div>
    <div style={bar}>
      <span style={caption}>context 45%</span>
      <ProgressBar label="Context window usage" value={45} style={track} />
    </div>
    <div style={bar}>
      <span style={caption}>context 100%</span>
      <ProgressBar label="Context window usage" value={100} style={track} />
    </div>
  </div>
)

export const Tones = () => (
  <div style={surface}>
    {(
      [
        ['neutral', 'idle session'],
        ['primary', 'claude tokens'],
        ['secondary', 'diff coverage'],
        ['success', 'tests passing'],
        ['warning', 'context pressure'],
        ['error', 'rate limit'],
        ['tertiary', 'cache churn'],
        ['kimi', 'kimi tokens'],
      ] as const
    ).map(([tone, note]) => (
      <div key={tone} style={bar}>
        <span style={caption}>
          {tone} · {note}
        </span>
        <ProgressBar
          label={note}
          value={65}
          tone={tone}
          height="sm"
          style={track}
        />
      </div>
    ))}
  </div>
)

export const GradientAndHeights = () => (
  <div style={surface}>
    <div style={bar}>
      <span style={caption}>gradient primary · thin</span>
      <ProgressBar label="Session tokens" value={70} gradient style={track} />
    </div>
    <div style={bar}>
      <span style={caption}>gradient success · sm</span>
      <ProgressBar
        label="Vitest suite progress"
        value={70}
        tone="success"
        gradient
        height="sm"
        style={track}
      />
    </div>
    <div style={bar}>
      <span style={caption}>gradient kimi · md</span>
      <ProgressBar
        label="Kimi turn progress"
        value={70}
        tone="kimi"
        gradient
        height="md"
        style={track}
      />
    </div>
    <div style={bar}>
      <span style={caption}>solid primary · md · chip radius</span>
      <ProgressBar
        label="Checkout progress"
        value={70}
        height="md"
        radius="chip"
        style={track}
      />
    </div>
  </div>
)

// Stacked segments — the agent-status token-cache bucket distribution.
export const CacheSegments = () => (
  <div style={surface}>
    <div style={{ ...bar, width: 280 }}>
      <span style={caption}>
        token cache buckets · read 58% / write 27% / miss 15%
      </span>
      <ProgressBar
        label="Token cache bucket distribution"
        decorative
        height="md"
        style={track}
        segments={[
          { value: 58, style: { background: 'var(--color-success)' } },
          { value: 27, style: { background: 'var(--color-primary)' } },
          { value: 15, style: { background: 'var(--color-warning)' } },
        ]}
      />
    </div>
    <div style={{ ...bar, width: 280 }}>
      <span style={caption}>diff stat · +182 / −64</span>
      <ProgressBar
        label="Diff additions vs deletions"
        decorative
        height="sm"
        style={track}
        segments={[
          { value: 182, style: { background: 'var(--color-success)' } },
          { value: 64, style: { background: 'var(--color-error)' } },
        ]}
      />
    </div>
  </div>
)
