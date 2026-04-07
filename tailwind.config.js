/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Primary & Secondary
        primary: '#e2c7ff',
        'primary-container': '#cba6f7',
        'primary-dim': '#d3b9f0',
        'primary-fixed': '#eedbff',
        'primary-fixed-dim': '#d9b9ff',
        secondary: '#a8c8ff',
        'secondary-container': '#124988',
        'secondary-dim': '#c39eee',
        'secondary-fixed': '#d5e3ff',
        'secondary-fixed-dim': '#a8c8ff',

        // Semantic & Feedback
        tertiary: '#ff94a5',
        'tertiary-container': '#fd7e94',
        'tertiary-fixed': '#f3deda',
        'tertiary-fixed-dim': '#d6c2be',
        error: '#ffb4ab',
        'error-container': '#93000a',
        'error-dim': '#d73357',
        success: '#50fa7b',
        'success-muted': '#7defa1',

        // Surface Hierarchy
        surface: '#121221',
        background: '#121221',
        'surface-container-lowest': '#0d0d1c',
        'surface-container-low': '#1a1a2a',
        'surface-container': '#1e1e2e',
        'surface-container-high': '#292839',
        'surface-container-highest': '#333344',
        'surface-dim': '#121221',
        'surface-bright': '#383849',
        'surface-tint': '#d9b9ff',
        'surface-variant': '#333344',

        // Text & Borders
        'on-surface': '#e3e0f7',
        'on-surface-variant': '#cdc3d1',
        'on-background': '#e3e0f7',
        'on-primary': '#3f1e66',
        'on-primary-container': '#57377f',
        'on-primary-fixed': '#290350',
        'on-primary-fixed-variant': '#57377f',
        'on-secondary': '#003062',
        'on-secondary-container': '#8fbaff',
        'on-secondary-fixed': '#001b3c',
        'on-secondary-fixed-variant': '#0e4685',
        'on-tertiary': '#3a2e2b',
        'on-tertiary-container': '#524442',
        'on-tertiary-fixed': '#241917',
        'on-tertiary-fixed-variant': '#514441',
        'on-error': '#690005',
        'on-error-container': '#ffdad6',
        outline: '#968e9a',
        'outline-variant': '#4a444f',

        // Inverse
        'inverse-surface': '#e3e0f7',
        'inverse-on-surface': '#2f2f40',
        'inverse-primary': '#704f98',
      },
      fontFamily: {
        headline: ['Manrope', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
        label: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '0.25rem',
        lg: '0.5rem',
        xl: '0.75rem',
        full: '9999px',
      },
    },
  },
  plugins: [],
}
