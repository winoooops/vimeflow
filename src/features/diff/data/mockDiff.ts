import type { ChangedFile, FileDiff } from '../types'

/** Mock changed files matching the Files Explorer mock data */
export const mockChangedFiles: ChangedFile[] = [
  {
    path: 'src/components/NavBar.tsx',
    status: 'M',
    insertions: 12,
    deletions: 3,
    staged: false,
  },
  {
    path: 'src/components/TerminalPanel.tsx',
    status: 'M',
    insertions: 8,
    deletions: 5,
    staged: false,
  },
  {
    path: 'src/utils/api-helper.rs',
    status: 'A',
    insertions: 45,
    deletions: 0,
    staged: true,
  },
  {
    path: 'tsconfig.json',
    status: 'D',
    insertions: 0,
    deletions: 18,
    staged: false,
  },
]

/** Mock diff for NavBar.tsx (M, +12 -3, two hunks) */
const navBarDiff: FileDiff = {
  filePath: 'src/components/NavBar.tsx',
  oldPath: 'src/components/NavBar.tsx',
  newPath: 'src/components/NavBar.tsx',
  hunks: [
    {
      id: 'hunk-0',
      header: '@@ -1,8 +1,10 @@',
      oldStart: 1,
      oldLines: 8,
      newStart: 1,
      newLines: 10,
      lines: [
        {
          type: 'context',
          oldLineNumber: 1,
          newLineNumber: 1,
          content: "import React from 'react'",
        },
        {
          type: 'removed',
          oldLineNumber: 2,
          content: "import { Link } from 'react-router-dom'",
        },
        {
          type: 'added',
          newLineNumber: 2,
          content: "import { Link, useLocation } from 'react-router-dom'",
          highlights: [
            { start: 18, end: 30 }, // "useLocation"
          ],
        },
        {
          type: 'added',
          newLineNumber: 3,
          content: "import type { NavItem } from '../types'",
        },
        {
          type: 'context',
          oldLineNumber: 3,
          newLineNumber: 4,
          content: '',
        },
        {
          type: 'context',
          oldLineNumber: 4,
          newLineNumber: 5,
          content: 'export const NavBar = (): JSX.Element => {',
        },
        {
          type: 'added',
          newLineNumber: 6,
          content: '  const location = useLocation()',
        },
        {
          type: 'context',
          oldLineNumber: 5,
          newLineNumber: 7,
          content: '  return (',
        },
        {
          type: 'context',
          oldLineNumber: 6,
          newLineNumber: 8,
          content: '    <header className="border-b border-gray-800 p-4">',
        },
        {
          type: 'context',
          oldLineNumber: 7,
          newLineNumber: 9,
          content: '      <h1 className="text-2xl font-bold">My App</h1>',
        },
      ],
    },
    {
      id: 'hunk-1',
      header: '@@ -15,9 +17,18 @@',
      oldStart: 15,
      oldLines: 9,
      newStart: 17,
      newLines: 18,
      lines: [
        {
          type: 'context',
          oldLineNumber: 15,
          newLineNumber: 17,
          content: '      <nav className="mt-4">',
        },
        {
          type: 'removed',
          oldLineNumber: 16,
          content: '        <div className="flex gap-4">',
        },
        {
          type: 'removed',
          oldLineNumber: 17,
          content: '          <Link to="/">Home</Link>',
        },
        {
          type: 'removed',
          oldLineNumber: 18,
          content: '          <Link to="/settings">Settings</Link>',
        },
        {
          type: 'removed',
          oldLineNumber: 19,
          content: '        </div>',
        },
        {
          type: 'added',
          newLineNumber: 18,
          content: '        const navItems: NavItem[] = [',
        },
        {
          type: 'added',
          newLineNumber: 19,
          content: "          { path: '/', label: 'Home', icon: 'home' },",
        },
        {
          type: 'added',
          newLineNumber: 20,
          content:
            "          { path: '/settings', label: 'Settings', icon: 'settings' },",
        },
        {
          type: 'added',
          newLineNumber: 21,
          content:
            "          { path: '/diff', label: 'Diff', icon: 'difference' },",
        },
        {
          type: 'added',
          newLineNumber: 22,
          content: '        ]',
        },
        {
          type: 'added',
          newLineNumber: 23,
          content: '',
        },
        {
          type: 'added',
          newLineNumber: 24,
          content: '        <div className="flex gap-4">',
        },
        {
          type: 'added',
          newLineNumber: 25,
          content: '          {navItems.map((item) => (',
        },
        {
          type: 'added',
          newLineNumber: 26,
          content: '            <Link',
        },
        {
          type: 'added',
          newLineNumber: 27,
          content: '              key={item.path}',
        },
        {
          type: 'added',
          newLineNumber: 28,
          content: '              to={item.path}',
        },
        {
          type: 'added',
          newLineNumber: 29,
          content:
            "              className={location.pathname === item.path ? 'text-primary' : 'text-on-surface-variant'}",
        },
        {
          type: 'added',
          newLineNumber: 30,
          content: '            >',
        },
        {
          type: 'added',
          newLineNumber: 31,
          content: '              {item.label}',
        },
        {
          type: 'added',
          newLineNumber: 32,
          content: '            </Link>',
        },
        {
          type: 'added',
          newLineNumber: 33,
          content: '          ))}',
        },
        {
          type: 'added',
          newLineNumber: 34,
          content: '        </div>',
        },
        {
          type: 'context',
          oldLineNumber: 20,
          newLineNumber: 35,
          content: '      </nav>',
        },
      ],
    },
  ],
}

/** Mock diff for TerminalPanel.tsx (M, +8 -5, one hunk) */
const terminalPanelDiff: FileDiff = {
  filePath: 'src/components/TerminalPanel.tsx',
  oldPath: 'src/components/TerminalPanel.tsx',
  newPath: 'src/components/TerminalPanel.tsx',
  hunks: [
    {
      id: 'hunk-0',
      header: '@@ -22,14 +22,17 @@',
      oldStart: 22,
      oldLines: 14,
      newStart: 22,
      newLines: 17,
      lines: [
        {
          type: 'context',
          oldLineNumber: 22,
          newLineNumber: 22,
          content: 'export const TerminalPanel = (): JSX.Element => {',
        },
        {
          type: 'removed',
          oldLineNumber: 23,
          content: '  const [height] = useState(200)',
        },
        {
          type: 'removed',
          oldLineNumber: 24,
          content: '',
        },
        {
          type: 'added',
          newLineNumber: 23,
          content: '  const [height, setHeight] = useState(200)',
          highlights: [
            { start: 16, end: 26 }, // "setHeight"
          ],
        },
        {
          type: 'added',
          newLineNumber: 24,
          content: '  const [collapsed, setCollapsed] = useState(false)',
        },
        {
          type: 'added',
          newLineNumber: 25,
          content: '',
        },
        {
          type: 'context',
          oldLineNumber: 25,
          newLineNumber: 26,
          content: '  return (',
        },
        {
          type: 'removed',
          oldLineNumber: 26,
          content:
            '    <div style={{ height }} className="bg-surface-container">',
        },
        {
          type: 'removed',
          oldLineNumber: 27,
          content: '      <div className="p-2 font-label text-sm">',
        },
        {
          type: 'removed',
          oldLineNumber: 28,
          content:
            '        <span className="text-primary">$</span> npm run dev',
        },
        {
          type: 'added',
          newLineNumber: 27,
          content:
            '    <div style={{ height: collapsed ? 32 : height }} className="bg-surface-container relative">',
          highlights: [
            { start: 24, end: 50 }, // "collapsed ? 32 : height"
          ],
        },
        {
          type: 'added',
          newLineNumber: 28,
          content: '      <div',
        },
        {
          type: 'added',
          newLineNumber: 29,
          content:
            '        className="absolute top-0 left-0 right-0 h-1 cursor-row-resize hover:bg-primary/30"',
        },
        {
          type: 'added',
          newLineNumber: 30,
          content: '        onMouseDown={handleResizeStart}',
        },
        {
          type: 'added',
          newLineNumber: 31,
          content: '      />',
        },
        {
          type: 'added',
          newLineNumber: 32,
          content:
            '      <div className="p-2 font-label text-sm flex items-center justify-between">',
        },
        {
          type: 'added',
          newLineNumber: 33,
          content:
            '        <span><span className="text-primary">$</span> npm run dev</span>',
        },
        {
          type: 'added',
          newLineNumber: 34,
          content:
            '        <button onClick={() => setCollapsed(!collapsed)} className="text-on-surface-variant">',
        },
        {
          type: 'added',
          newLineNumber: 35,
          content: "          {collapsed ? '▲' : '▼'}",
        },
        {
          type: 'added',
          newLineNumber: 36,
          content: '        </button>',
        },
        {
          type: 'context',
          oldLineNumber: 29,
          newLineNumber: 37,
          content: '      </div>',
        },
      ],
    },
  ],
}

/** Mock diff for api-helper.rs (A, +45 -0, one hunk - all new file) */
const apiHelperDiff: FileDiff = {
  filePath: 'src/utils/api-helper.rs',
  oldPath: '/dev/null',
  newPath: 'src/utils/api-helper.rs',
  hunks: [
    {
      id: 'hunk-0',
      header: '@@ -0,0 +1,45 @@',
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: 45,
      lines: [
        { type: 'added', newLineNumber: 1, content: 'use reqwest::Client;' },
        {
          type: 'added',
          newLineNumber: 2,
          content: 'use serde::{Deserialize, Serialize};',
        },
        { type: 'added', newLineNumber: 3, content: '' },
        {
          type: 'added',
          newLineNumber: 4,
          content: '#[derive(Debug, Serialize, Deserialize)]',
        },
        {
          type: 'added',
          newLineNumber: 5,
          content: 'pub struct ApiResponse<T> {',
        },
        { type: 'added', newLineNumber: 6, content: '    pub success: bool,' },
        {
          type: 'added',
          newLineNumber: 7,
          content: '    pub data: Option<T>,',
        },
        {
          type: 'added',
          newLineNumber: 8,
          content: '    pub error: Option<String>,',
        },
        { type: 'added', newLineNumber: 9, content: '}' },
        { type: 'added', newLineNumber: 10, content: '' },
        { type: 'added', newLineNumber: 11, content: 'pub struct ApiHelper {' },
        { type: 'added', newLineNumber: 12, content: '    client: Client,' },
        { type: 'added', newLineNumber: 13, content: '    base_url: String,' },
        { type: 'added', newLineNumber: 14, content: '}' },
        { type: 'added', newLineNumber: 15, content: '' },
        { type: 'added', newLineNumber: 16, content: 'impl ApiHelper {' },
        {
          type: 'added',
          newLineNumber: 17,
          content: '    pub fn new(base_url: &str) -> Self {',
        },
        { type: 'added', newLineNumber: 18, content: '        Self {' },
        {
          type: 'added',
          newLineNumber: 19,
          content: '            client: Client::new(),',
        },
        {
          type: 'added',
          newLineNumber: 20,
          content: '            base_url: base_url.to_string(),',
        },
        { type: 'added', newLineNumber: 21, content: '        }' },
        { type: 'added', newLineNumber: 22, content: '    }' },
        { type: 'added', newLineNumber: 23, content: '' },
        {
          type: 'added',
          newLineNumber: 24,
          content: "    pub async fn get<T: for<'de> Deserialize<'de>>(",
        },
        { type: 'added', newLineNumber: 25, content: '        &self,' },
        { type: 'added', newLineNumber: 26, content: '        path: &str,' },
        {
          type: 'added',
          newLineNumber: 27,
          content: '    ) -> Result<ApiResponse<T>, reqwest::Error> {',
        },
        {
          type: 'added',
          newLineNumber: 28,
          content: '        let url = format!("{}{}", self.base_url, path);',
        },
        {
          type: 'added',
          newLineNumber: 29,
          content:
            '        let response = self.client.get(&url).send().await?;',
        },
        {
          type: 'added',
          newLineNumber: 30,
          content:
            '        let result = response.json::<ApiResponse<T>>().await?;',
        },
        { type: 'added', newLineNumber: 31, content: '        Ok(result)' },
        { type: 'added', newLineNumber: 32, content: '    }' },
        { type: 'added', newLineNumber: 33, content: '' },
        {
          type: 'added',
          newLineNumber: 34,
          content: '    pub async fn post<T, B>(',
        },
        { type: 'added', newLineNumber: 35, content: '        &self,' },
        { type: 'added', newLineNumber: 36, content: '        path: &str,' },
        { type: 'added', newLineNumber: 37, content: '        body: &B,' },
        {
          type: 'added',
          newLineNumber: 38,
          content: '    ) -> Result<ApiResponse<T>, reqwest::Error>',
        },
        { type: 'added', newLineNumber: 39, content: '    where' },
        {
          type: 'added',
          newLineNumber: 40,
          content: "        T: for<'de> Deserialize<'de>,",
        },
        { type: 'added', newLineNumber: 41, content: '        B: Serialize,' },
        { type: 'added', newLineNumber: 42, content: '    {' },
        {
          type: 'added',
          newLineNumber: 43,
          content: '        let url = format!("{}{}", self.base_url, path);',
        },
        {
          type: 'added',
          newLineNumber: 44,
          content:
            '        let response = self.client.post(&url).json(body).send().await?;',
        },
        {
          type: 'added',
          newLineNumber: 45,
          content:
            '        let result = response.json::<ApiResponse<T>>().await?;',
        },
        { type: 'added', newLineNumber: 46, content: '        Ok(result)' },
        { type: 'added', newLineNumber: 47, content: '    }' },
        { type: 'added', newLineNumber: 48, content: '}' },
      ],
    },
  ],
}

/** Mock diff for tsconfig.json (D, +0 -18, one hunk - full deletion) */
const tsconfigDiff: FileDiff = {
  filePath: 'tsconfig.json',
  oldPath: 'tsconfig.json',
  newPath: '/dev/null',
  hunks: [
    {
      id: 'hunk-0',
      header: '@@ -1,18 +0,0 @@',
      oldStart: 1,
      oldLines: 18,
      newStart: 0,
      newLines: 0,
      lines: [
        { type: 'removed', oldLineNumber: 1, content: '{' },
        {
          type: 'removed',
          oldLineNumber: 2,
          content: '  "compilerOptions": {',
        },
        {
          type: 'removed',
          oldLineNumber: 3,
          content: '    "target": "ES2020",',
        },
        {
          type: 'removed',
          oldLineNumber: 4,
          content: '    "useDefineForClassFields": true,',
        },
        {
          type: 'removed',
          oldLineNumber: 5,
          content: '    "lib": ["ES2020", "DOM", "DOM.Iterable"],',
        },
        {
          type: 'removed',
          oldLineNumber: 6,
          content: '    "module": "ESNext",',
        },
        {
          type: 'removed',
          oldLineNumber: 7,
          content: '    "skipLibCheck": true,',
        },
        {
          type: 'removed',
          oldLineNumber: 8,
          content: '    "moduleResolution": "bundler",',
        },
        {
          type: 'removed',
          oldLineNumber: 9,
          content: '    "allowImportingTsExtensions": true,',
        },
        {
          type: 'removed',
          oldLineNumber: 10,
          content: '    "resolveJsonModule": true,',
        },
        {
          type: 'removed',
          oldLineNumber: 11,
          content: '    "isolatedModules": true,',
        },
        { type: 'removed', oldLineNumber: 12, content: '    "noEmit": true,' },
        {
          type: 'removed',
          oldLineNumber: 13,
          content: '    "jsx": "react-jsx",',
        },
        { type: 'removed', oldLineNumber: 14, content: '    "strict": true,' },
        {
          type: 'removed',
          oldLineNumber: 15,
          content: '    "noUnusedLocals": true,',
        },
        {
          type: 'removed',
          oldLineNumber: 16,
          content: '    "noUnusedParameters": true,',
        },
        {
          type: 'removed',
          oldLineNumber: 17,
          content: '    "noFallthroughCasesInSwitch": true',
        },
        { type: 'removed', oldLineNumber: 18, content: '  },' },
        { type: 'removed', oldLineNumber: 19, content: '  "include": ["src"]' },
        { type: 'removed', oldLineNumber: 20, content: '}' },
      ],
    },
  ],
}

/** Map of file paths to their diffs */
export const mockFileDiffs: Record<string, FileDiff> = {
  'src/components/NavBar.tsx': navBarDiff,
  'src/components/TerminalPanel.tsx': terminalPanelDiff,
  'src/utils/api-helper.rs': apiHelperDiff,
  'tsconfig.json': tsconfigDiff,
}
