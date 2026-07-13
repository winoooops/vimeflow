import type {
  AgentAccent,
  ThemeDefinition,
  ThemePalette,
  ThemeScheme,
} from './types'

/**
 * User color schemes contain a small base palette instead of every runtime
 * token. This module expands that palette into the complete theme consumed by
 * the interface, editor, terminal, effects, and agent surfaces. Keeping the
 * derivation here makes new schemes consistent and lets the runtime token set
 * evolve without forcing users to rewrite saved JSON files.
 */

type Rgb = readonly [number, number, number]

const parseHex = (hex: string): Rgb => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
]

const toHex = ([red, green, blue]: Rgb): string =>
  `#${[red, green, blue]
    .map((channel) => Math.round(channel).toString(16).padStart(2, '0'))
    .join('')}`

const mix = (from: string, to: string, amount: number): string => {
  const fromRgb = parseHex(from)
  const toRgb = parseHex(to)

  return toHex(
    fromRgb.map(
      (channel, index) => channel + (toRgb[index] - channel) * amount
    ) as unknown as Rgb
  )
}

const alpha = (hex: string, opacity: number): string => {
  const [red, green, blue] = parseHex(hex)

  return `rgb(${red} ${green} ${blue} / ${opacity})`
}

const luminance = (hex: string): number => {
  const channels = parseHex(hex).map((channel) => {
    const normalized = channel / 255

    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4
  })

  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

const contrastRatio = (left: string, right: string): number => {
  const brightest = Math.max(luminance(left), luminance(right))
  const darkest = Math.min(luminance(left), luminance(right))

  return (brightest + 0.05) / (darkest + 0.05)
}

const onColor = (color: string, palette: ThemePalette): string =>
  contrastRatio(color, palette.background) >=
  contrastRatio(color, palette.foreground)
    ? palette.background
    : palette.foreground

const agentAccent = (accent: string, palette: ThemePalette): AgentAccent => ({
  accent,
  accentDim: alpha(accent, 0.16),
  accentSoft: alpha(accent, 0.32),
  onAccent: onColor(accent, palette),
})

export const deriveTheme = (scheme: ThemeScheme): ThemeDefinition => {
  const { palette, kind } = scheme
  const light = kind === 'light'
  const wash = light ? palette.foreground : '#ffffff'
  const shadow = light ? palette.foreground : '#000000'
  const orange = mix(palette.red, palette.yellow, 0.5)

  const terminalBackground = mix(
    palette.background,
    palette.foreground,
    light ? 0.025 : 0.035
  )

  const surfaceStep = (darkAmount: number, lightAmount: number): string =>
    mix(palette.surface, palette.foreground, light ? lightAmount : darkAmount)

  return {
    id: scheme.id,
    label: scheme.label,
    kind,
    ui: {
      surface: palette.surface,
      'surface-container-lowest': palette.background,
      'surface-container-low': surfaceStep(0.04, 0.08),
      'surface-container': surfaceStep(0.08, 0.14),
      'surface-container-high': surfaceStep(0.12, 0.22),
      'surface-container-highest': surfaceStep(0.18, 0.3),
      'surface-bright': light ? palette.background : surfaceStep(0.22, 0.34),
      'surface-tint': palette.primary,
      'browser-bar': mix(palette.background, palette.surface, 0.5),
      'browser-tab-active': surfaceStep(0.08, 0.14),
      primary: palette.primary,
      'primary-container': mix(palette.primary, palette.foreground, 0.16),
      'primary-dim': mix(palette.primary, palette.background, 0.18),
      'primary-deep': mix(palette.primary, palette.background, 0.55),
      'on-primary': onColor(palette.primary, palette),
      secondary: palette.secondary,
      'secondary-container': mix(palette.secondary, palette.background, 0.28),
      'secondary-dim': mix(palette.secondary, palette.background, 0.16),
      'on-secondary': onColor(palette.secondary, palette),
      'on-secondary-container': onColor(
        mix(palette.secondary, palette.background, 0.28),
        palette
      ),
      tertiary: palette.magenta,
      'tertiary-container': mix(palette.magenta, palette.background, 0.2),
      'on-tertiary': onColor(palette.magenta, palette),
      'on-tertiary-container': onColor(
        mix(palette.magenta, palette.background, 0.2),
        palette
      ),
      error: palette.red,
      'error-container': mix(palette.red, palette.background, 0.2),
      'error-dim': mix(palette.red, palette.background, 0.16),
      'on-error': onColor(palette.red, palette),
      'on-error-container': onColor(
        mix(palette.red, palette.background, 0.2),
        palette
      ),
      success: palette.green,
      'success-muted': mix(palette.green, palette.muted, 0.28),
      warning: orange,
      'on-surface': palette.foreground,
      'on-surface-variant': mix(palette.foreground, palette.muted, 0.35),
      'on-surface-muted': palette.muted,
      outline: mix(palette.muted, palette.foreground, 0.25),
      'outline-variant': mix(palette.surface, palette.muted, 0.45),
      'editor-fg': palette.foreground,
      'editor-fg-dim': palette.muted,
      'vcs-modified': palette.yellow,
      'vcs-added': palette.green,
      'vcs-deleted': palette.red,
      'vcs-renamed': palette.cyan,
      'vcs-untracked': palette.magenta,
    },
    effects: {
      'glass-fill': alpha(palette.surface, 0.88),
      selection: alpha(palette.primary, light ? 0.25 : 0.3),
      'scrollbar-thumb': surfaceStep(0.18, 0.14),
      'scrollbar-thumb-hover': mix(palette.surface, palette.muted, 0.55),
      'diff-added': alpha(palette.green, light ? 0.14 : 0.15),
      'diff-removed': alpha(palette.red, light ? 0.12 : 0.15),
      'diff-highlight-added': alpha(palette.green, light ? 0.3 : 0.35),
      'diff-highlight-removed': alpha(palette.red, light ? 0.28 : 0.35),
      'wash-faint': alpha(wash, 0.04),
      'wash-subtle': alpha(wash, 0.05),
      'wash-soft': alpha(wash, 0.08),
      scrim: '#000000',
    },
    shadows: {
      'pane-focus': `0 0 0 6px ${alpha(palette.primary, 0.16)}, 0 8px 32px ${alpha(shadow, light ? 0.12 : 0.35)}`,
      modal: `0 24px 80px ${alpha(shadow, light ? 0.18 : 0.5)}`,
      'pip-glow': '0 0 4px currentColor',
      ambient: `0 10px 40px ${alpha(shadow, light ? 0.12 : 0.4)}`,
      'glow-primary': `0 0 24px ${alpha(palette.primary, light ? 0.2 : 0.35)}`,
      'ring-primary': `0 0 0 3px ${alpha(palette.primary, light ? 0.25 : 0.28)}`,
    },
    syntax: {
      keyword: palette.primary,
      string: palette.green,
      fn: palette.blue,
      variable: palette.magenta,
      comment: palette.muted,
      type: orange,
      tag: palette.red,
      class: palette.yellow,
      operator: palette.cyan,
    },
    terminal: {
      foreground: palette.foreground,
      background: terminalBackground,
      cursor: palette.primary,
      cursorAccent: terminalBackground,
      selectionBackground: mix(terminalBackground, palette.primary, 0.35),
      black: light ? palette.foreground : palette.surface,
      red: palette.red,
      green: palette.green,
      yellow: palette.yellow,
      blue: palette.blue,
      magenta: palette.magenta,
      cyan: palette.cyan,
      white: light ? palette.surface : palette.foreground,
      brightBlack: palette.muted,
      brightRed: mix(palette.red, palette.foreground, 0.18),
      brightGreen: mix(palette.green, palette.foreground, 0.18),
      brightYellow: mix(palette.yellow, palette.foreground, 0.18),
      brightBlue: mix(palette.blue, palette.foreground, 0.18),
      brightMagenta: mix(palette.magenta, palette.foreground, 0.18),
      brightCyan: mix(palette.cyan, palette.foreground, 0.18),
      brightWhite: mix(palette.foreground, palette.background, 0.08),
    },
    agents: {
      claude: agentAccent(palette.primary, palette),
      codex: agentAccent(palette.green, palette),
      shell: agentAccent(palette.yellow, palette),
      browser: agentAccent(palette.cyan, palette),
      kimi: agentAccent(orange, palette),
      opencode: agentAccent(palette.blue, palette),
    },
  }
}

export const themeToScheme = (theme: ThemeDefinition): ThemeScheme => ({
  id: theme.id,
  label: theme.label,
  kind: theme.kind,
  palette: {
    background: theme.ui['surface-container-lowest'],
    surface: theme.ui.surface,
    foreground: theme.ui['on-surface'],
    muted: theme.ui['on-surface-muted'],
    primary: theme.ui.primary,
    secondary: theme.ui.secondary,
    red: theme.terminal.red,
    green: theme.terminal.green,
    yellow: theme.terminal.yellow,
    blue: theme.terminal.blue,
    magenta: theme.terminal.magenta,
    cyan: theme.terminal.cyan,
  },
})
