import type { ReactElement } from 'react'

/**
 * EditorPanel displays a placeholder editor view in the sidebar context panel (260px width).
 * Shows a message prompting the user to open a file.
 */
export const EditorPanel = (): ReactElement => (
  <div
    className="flex flex-1 flex-col items-center justify-center px-4 py-8 text-center"
    data-testid="editor-panel"
  >
    <div className="mb-4 text-4xl">📝</div>

    <h3 className="mb-2 font-label text-sm font-medium text-on-surface">
      No file open
    </h3>

    <p className="font-body text-xs text-on-surface/60">
      Select a file from the Files tab or terminal to view it here
    </p>
  </div>
)
