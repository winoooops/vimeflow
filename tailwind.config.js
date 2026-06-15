/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      keyframes: {
        'browser-load-bar': {
          '0%': { transform: 'translateX(-110%)' },
          '100%': { transform: 'translateX(340%)' },
        },
      },
      animation: {
        'browser-load-bar': 'browser-load-bar 1.4s ease-in-out infinite',
      },
      fontFamily: {
        headline: ['Manrope', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
        label: ['Inter', 'sans-serif'],
        mono: ['Ioskeley Mono', 'JetBrains Mono', 'ui-monospace', 'monospace'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui'],
        display: ['Instrument Sans', 'Manrope', 'system-ui'],
      },
      fontSize: {
        'vf-2xs': ['10px', { lineHeight: '14px' }],
        'vf-xs': ['10.5px', { lineHeight: '15px' }],
        'vf-sm': ['11.5px', { lineHeight: '16px' }],
        'vf-base': ['13px', { lineHeight: '19px' }],
        'vf-lg': ['16px', { lineHeight: '22px' }],
        'vf-xl': ['20px', { lineHeight: '26px' }],
        'vf-2xl': ['28px', { lineHeight: '32px' }],
      },
      borderRadius: {
        // Existing tokens use rem so they scale with the root font size.
        DEFAULT: '0.25rem',
        md: '0.75rem',
        lg: '1rem',
        xl: '1.5rem',
        full: '9999px',
        // Handoff additive tokens use px intentionally — the prototype is
        // pixel-perfect against Figma and the design relies on device-
        // pixel anchoring (e.g., `tab: '8px'` matches the 8px corner in
        // the screenshots regardless of OS text-scaling). Mixing units
        // with the rem tokens above is a deliberate trade-off: rem
        // tokens remain accessibility-friendly, px tokens lock the
        // Obsidian Lens chrome to the exact handoff geometry.
        pane: '10px',
        // tab: 8px corner radius. Compose at the call site: use
        // `rounded-t-tab` for the asymmetric top-rounded tab shape per
        // handoff §4.3. Stored as a single-value token (not the
        // handoff's `'8px 8px 0 0'` shorthand) because Tailwind generates
        // directional `rounded-t-tab` / `-b-` / `-l-` / `-r-` utilities,
        // and multi-value shorthand emits invalid CSS for those longhand
        // properties. Single-value form keeps `rounded-t-tab` and the
        // other directional variants valid.
        tab: '8px',
        chip: '6px',
        pill: '999px',
        modal: '12px',
      },
      transitionTimingFunction: {
        pane: 'cubic-bezier(0.32, 0.72, 0, 1)',
      },
    },
  },
  plugins: [],
}
