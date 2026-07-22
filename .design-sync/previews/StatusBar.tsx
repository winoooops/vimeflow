import { StatusBar } from 'vibm'

const surface = {
  background: 'var(--color-surface)',
  color: 'var(--color-on-surface)',
  padding: '24px 0',
  borderRadius: 12,
  width: 720,
  maxWidth: '100%',
}

const noop = (): void => {}

export const ActiveSession = () => (
  <div style={surface}>
    <StatusBar
      session={{
        startedAgo: '2h',
        turns: 14,
        cache: { cached: 4200, wrote: 300, fresh: 900 },
        changes: { added: 128, removed: 42 },
      }}
      contextPct={32}
      dockOpen
      onOpenPalette={noop}
      onToggleDock={noop}
    />
  </div>
)

export const HighContext = () => (
  <div style={surface}>
    <StatusBar
      session={{
        startedAgo: '6h',
        turns: 87,
        cache: { cached: 1200, wrote: 2100, fresh: 2600 },
        changes: { added: 940, removed: 512 },
      }}
      contextPct={91}
      dockOpen={false}
      onOpenPalette={noop}
      onToggleDock={noop}
    />
  </div>
)

export const NoSession = () => (
  <div style={surface}>
    <StatusBar
      session={null}
      contextPct={null}
      dockOpen={false}
      onOpenPalette={noop}
      onToggleDock={noop}
    />
  </div>
)
