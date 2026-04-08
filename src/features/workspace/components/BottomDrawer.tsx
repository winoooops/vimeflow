import { type ReactElement, useState } from 'react'

type TabType = 'editor' | 'diff'

/**
 * BottomDrawer - Editor and Diff Viewer panel below terminal
 *
 * Features:
 * - Tab switching between Editor and Diff Viewer
 * - Syntax-highlighted code editor with line numbers
 * - File path display and collapse toggle
 * - Takes h-1/3 of workspace height
 */
const BottomDrawer = (): ReactElement => {
  const [activeTab, setActiveTab] = useState<TabType>('editor')

  return (
    <section
      data-testid="bottom-drawer"
      className="h-1/3 bg-slate-900/95 backdrop-blur-2xl border-t border-white/5 flex flex-col z-30"
    >
      {/* Tab Bar */}
      <div className="flex items-center px-8 h-12 bg-surface-container justify-between">
        {/* Left: Tab Buttons */}
        <div className="flex space-x-6">
          {/* Editor Tab */}
          <button
            onClick={() => {
              setActiveTab('editor')
            }}
            className={`flex items-center space-x-2 font-mono text-xs h-12 px-2 transition-colors ${
              activeTab === 'editor'
                ? 'text-primary border-b-2 border-primary'
                : 'text-slate-400 hover:text-primary'
            }`}
            aria-label="Editor"
          >
            <span className="material-symbols-outlined text-sm">code</span>
            <span>Editor</span>
          </button>

          {/* Diff Viewer Tab */}
          <button
            onClick={() => {
              setActiveTab('diff')
            }}
            className={`flex items-center space-x-2 font-mono text-xs h-12 px-2 transition-colors ${
              activeTab === 'diff'
                ? 'text-primary border-b-2 border-primary'
                : 'text-slate-400 hover:text-primary'
            }`}
            aria-label="Diff Viewer"
          >
            <span className="material-symbols-outlined text-sm">
              difference
            </span>
            <span>Diff Viewer</span>
          </button>
        </div>

        {/* Right: File Path + Collapse Toggle */}
        <div className="flex items-center space-x-4">
          <span className="text-[10px] text-outline font-mono">
            src/middleware/auth.ts
          </span>
          <button
            aria-label="Collapse drawer"
            className="material-symbols-outlined text-sm text-outline hover:text-on-surface cursor-pointer transition-colors"
          >
            keyboard_arrow_down
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 font-mono text-xs p-6 overflow-y-auto bg-black/30">
        {activeTab === 'editor' ? (
          <div data-testid="editor-panel">
            <EditorContent />
          </div>
        ) : (
          <div data-testid="diff-panel">
            <DiffContent />
          </div>
        )}
      </div>
    </section>
  )
}

/**
 * EditorContent - Mock syntax-highlighted code with line numbers
 */
const EditorContent = (): ReactElement => (
  <div className="flex">
    {/* Line Number Gutter */}
    <div className="w-12 text-outline/40 text-right pr-4 select-none">
      1<br />
      2<br />
      3<br />
      4<br />
      5<br />
      6<br />
      7<br />
      8<br />
      9<br />
      10
    </div>

    {/* Code Content */}
    <div className="flex-1 space-y-1">
      <p>
        <span className="text-tertiary">import</span>
        {' { jose } '}
        <span className="text-tertiary">from</span>{' '}
        <span className="text-emerald-400">&apos;jose&apos;</span>;
      </p>
      <p>
        <span className="text-tertiary">import</span>
        {' type { NextRequest } '}
        <span className="text-tertiary">from</span>{' '}
        <span className="text-emerald-400">&apos;next/server&apos;</span>;
      </p>
      <p>&nbsp;</p>
      <p>
        <span className="text-tertiary">export async function</span>{' '}
        <span className="text-primary-dim">middleware</span>(req: NextRequest){' '}
        {'{'}
      </p>
      <p className="pl-4">
        <span className="text-on-surface-variant">
          {/* Refactored token validation */}
        </span>
      </p>
      <p className="pl-4">
        <span className="text-tertiary">const</span> token = req.headers.get(
        <span className="text-emerald-400">&apos;authorization&apos;</span>);
      </p>
      <p className="pl-4">
        <span className="text-tertiary">if</span> (!token){' '}
        <span className="text-tertiary">return</span> Response.json({'{ '}
        error:{' '}
        <span className="text-emerald-400">&apos;Unauthorized&apos;</span>
        {' }'}, {'{ '}status: 401 {'}'});
      </p>
      <p className="pl-4">&nbsp;</p>
      <p className="pl-4">
        <span className="text-tertiary">try</span> {'{'}
      </p>
      <p className="pl-8">
        <span className="text-tertiary">const</span> {'{ '}payload {'} ='}{' '}
        <span className="text-tertiary">await</span> jose.jwtVerify(token,{' '}
        <span className="text-tertiary">new</span>{' '}
        TextEncoder().encode(process.env.JWT_SECRET));
      </p>
    </div>
  </div>
)

/**
 * DiffContent - Placeholder for diff viewer
 */
const DiffContent = (): ReactElement => (
  <div className="flex items-center justify-center h-full text-on-surface-variant">
    <div className="text-center space-y-2">
      <p className="text-sm">No changes to review</p>
      <p className="text-xs opacity-60">Modified files will appear here</p>
    </div>
  </div>
)

export default BottomDrawer
