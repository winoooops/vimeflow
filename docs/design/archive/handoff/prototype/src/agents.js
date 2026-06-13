// Vimeflow — agent identity registry. Each agent has a name, accent color, glyph,
// and a fake terminal narrative so panes feel alive. Add new agents here.

window.VIMEFLOW_AGENTS = {
  claude: {
    id: 'claude',
    name: 'Claude Code',
    short: 'CLAUDE',
    glyph: '∴',
    accent: '#cba6f7', // lavender
    accentDim: 'rgba(203,166,247,0.16)',
    accentSoft: 'rgba(203,166,247,0.32)',
    onAccent: '#2a1646',
    model: 'sonnet-4',
  },
  codex: {
    id: 'codex',
    name: 'Codex CLI',
    short: 'CODEX',
    glyph: '◇',
    accent: '#7defa1', // mint
    accentDim: 'rgba(125,239,161,0.16)',
    accentSoft: 'rgba(125,239,161,0.32)',
    onAccent: '#0a2415',
    model: 'gpt-5-codex',
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini CLI',
    short: 'GEMINI',
    glyph: '✦',
    accent: '#a8c8ff', // blue
    accentDim: 'rgba(168,200,255,0.16)',
    accentSoft: 'rgba(168,200,255,0.32)',
    onAccent: '#0e1c33',
    model: 'gemini-2.5',
  },
  shell: {
    id: 'shell',
    name: 'shell',
    short: 'SHELL',
    glyph: '$',
    accent: '#f0c674', // yellow
    accentDim: 'rgba(240,198,116,0.14)',
    accentSoft: 'rgba(240,198,116,0.30)',
    onAccent: '#2a1f08',
    model: null,
  },
}

// Per-pane sample scripts. Each pane gets its own narrative voice.
window.VIMEFLOW_PANE_SCRIPTS = {
  claude: [
    {
      t: 'meta',
      text: 'claude-code · attached to sess_auth · lavender accent',
    },
    {
      t: 'prompt',
      path: '~/vimeflow-core',
      branch: 'feat/jose-auth',
      cmd: 'claude --resume',
    },
    { t: 'agent', text: 'Loading auth.ts and the related test fixtures...' },
    {
      t: 'tool',
      name: 'read',
      args: 'src/middleware/auth.ts',
      status: 'ok',
      detail: 'cached · 0 tokens',
    },
    {
      t: 'tool',
      name: 'read',
      args: 'tests/auth.test.ts',
      status: 'ok',
      detail: 'cached · 0 tokens',
    },
    {
      t: 'agent',
      text: 'I see the legacy `jsonwebtoken` import; I will migrate it to `jose`.',
    },
    {
      t: 'tool',
      name: 'edit',
      args: 'src/middleware/auth.ts',
      status: 'ok',
      detail: '+12 −2',
    },
    {
      t: 'tool',
      name: 'bash',
      args: 'pnpm test auth',
      status: 'ok',
      detail: '4 pass / 1 fail',
    },
    {
      t: 'agent',
      text: 'One test failing. Looking into the expired-token branch.',
    },
    {
      t: 'prompt',
      path: '~/vimeflow-core',
      branch: 'feat/jose-auth',
      cmd: '',
      cursor: true,
    },
  ],
  codex: [
    { t: 'meta', text: 'codex-cli · session $codex-2  · mint accent' },
    {
      t: 'prompt',
      path: '~/vimeflow-core',
      branch: 'feat/jose-auth',
      cmd: 'codex exec',
    },
    {
      t: 'agent',
      text: 'Reviewing diff from claude pane and writing the missing test case.',
    },
    {
      t: 'tool',
      name: 'read',
      args: 'src/middleware/auth.ts',
      status: 'ok',
      detail: '+ from claude',
    },
    {
      t: 'tool',
      name: 'edit',
      args: 'tests/auth.test.ts',
      status: 'ok',
      detail: '+18 −0',
    },
    {
      t: 'agent',
      text: 'Added a regression test for expired tokens. Running the suite.',
    },
    {
      t: 'tool',
      name: 'bash',
      args: 'pnpm test auth',
      status: 'ok',
      detail: '5 pass / 0 fail',
    },
    { t: 'agent', text: 'Green. Want me to open a PR?' },
    {
      t: 'prompt',
      path: '~/vimeflow-core',
      branch: 'feat/jose-auth',
      cmd: '',
      cursor: true,
    },
  ],
  gemini: [
    { t: 'meta', text: 'gemini-cli · session gem-1 · blue accent' },
    {
      t: 'prompt',
      path: '~/vimeflow-core',
      branch: 'feat/jose-auth',
      cmd: 'gemini chat',
    },
    { t: 'agent', text: 'Watching for unused imports across the codebase.' },
    {
      t: 'tool',
      name: 'grep',
      args: "'jsonwebtoken'",
      status: 'ok',
      detail: '0 matches',
    },
    { t: 'agent', text: 'Migration is clean. No dangling references.' },
    {
      t: 'prompt',
      path: '~/vimeflow-core',
      branch: 'feat/jose-auth',
      cmd: '',
      cursor: true,
    },
  ],
  shell: [
    { t: 'meta', text: 'shell · zsh' },
    {
      t: 'prompt',
      path: '~/vimeflow-core',
      branch: 'feat/jose-auth',
      cmd: 'pnpm dev',
    },
    { t: 'output', text: '▲ next.js 14.2.5' },
    { t: 'output', text: '- Local:        http://localhost:3000' },
    { t: 'output', text: '- Environment:  .env.local' },
    { t: 'output', text: '✓ Ready in 1.2s' },
    { t: 'output', text: '○ Compiling /api/auth ...' },
    { t: 'output', text: '✓ Compiled /api/auth in 340ms' },
    {
      t: 'prompt',
      path: '~/vimeflow-core',
      branch: 'feat/jose-auth',
      cmd: '',
      cursor: true,
    },
  ],
}

// Default pane configuration — Claude + Codex side-by-side, the canonical scenario.
window.VIMEFLOW_DEFAULT_PANES = [
  {
    id: 'p1',
    agentId: 'claude',
    sessionId: 'sess_auth',
    title: 'auth refactor',
  },
  {
    id: 'p2',
    agentId: 'codex',
    sessionId: 'sess_tests',
    title: 'test review',
  },
]
