import { Chip } from 'vibm'

const surface = {
  background: 'var(--color-surface)',
  color: 'var(--color-on-surface)',
  padding: 24,
  borderRadius: 12,
  display: 'flex',
  flexWrap: 'wrap' as const,
  alignItems: 'center',
  gap: 12,
}

export const Tones = () => (
  <div style={surface}>
    <Chip tone="neutral">main</Chip>
    <Chip tone="primary">claude</Chip>
    <Chip tone="secondary">VIM-362</Chip>
    <Chip tone="success">running</Chip>
    <Chip tone="warning">waiting</Chip>
    <Chip tone="error">failed</Chip>
    <Chip tone="tertiary">+3 files</Chip>
  </div>
)

export const Variants = () => (
  <div style={surface}>
    <Chip variant="subtle" tone="primary">
      subtle
    </Chip>
    <Chip variant="tinted" tone="primary">
      tinted
    </Chip>
    <Chip variant="solid" tone="primary">
      solid
    </Chip>
    <Chip variant="subtle" tone="success">
      subtle
    </Chip>
    <Chip variant="tinted" tone="success">
      tinted
    </Chip>
    <Chip variant="solid" tone="success">
      solid
    </Chip>
  </div>
)

export const Sizes = () => (
  <div style={surface}>
    <Chip size="xs" tone="primary">
      xs · 12 turns
    </Chip>
    <Chip size="sm" tone="primary">
      sm · 12 turns
    </Chip>
    <Chip size="md" tone="primary">
      md · 12 turns
    </Chip>
  </div>
)

export const Radii = () => (
  <div style={surface}>
    <Chip radius="chip" tone="secondary">
      radius chip
    </Chip>
    <Chip radius="md" tone="secondary">
      radius md
    </Chip>
    <Chip radius="pill" tone="secondary">
      radius pill
    </Chip>
  </div>
)
