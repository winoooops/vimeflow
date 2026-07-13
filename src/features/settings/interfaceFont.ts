export interface InterfaceFontOption {
  id: string
  label: string
  stack: string
}

export const INTERFACE_FONT_OPTIONS: readonly InterfaceFontOption[] = [
  {
    id: 'instrument',
    label: 'Instrument Sans',
    stack: "'Instrument Sans', system-ui, sans-serif",
  },
  {
    id: 'inter',
    label: 'Inter',
    stack: "'Inter', system-ui, sans-serif",
  },
  {
    id: 'manrope',
    label: 'Manrope',
    stack: "'Manrope', system-ui, sans-serif",
  },
]

export const resolveInterfaceFont = (id: string): InterfaceFontOption =>
  INTERFACE_FONT_OPTIONS.find((font) => font.id === id) ??
  INTERFACE_FONT_OPTIONS[0]

export const applyInterfaceFont = (root: HTMLElement, id: string): void => {
  const font = resolveInterfaceFont(id)

  root.style.setProperty('--font-display', font.stack)
  root.style.setProperty('--font-body', font.stack)
}
