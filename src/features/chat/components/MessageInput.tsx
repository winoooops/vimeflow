import type { ReactElement } from 'react'

const MessageInput = (): ReactElement => (
  <footer className="p-6" role="contentinfo" data-testid="message-input">
    <div
      className="max-w-3xl mx-auto relative"
      data-testid="message-input-container"
    >
      <textarea
        className="w-full bg-surface-container-highest/30 border-none rounded-2xl p-4 pr-16 focus:ring-2 focus:ring-primary/20 text-sm placeholder:text-on-surface-variant/40 resize-none glass-panel"
        placeholder="Ask anything or ' / ' for commands..."
        rows={3}
      />
      <div
        className="absolute right-4 bottom-4 flex gap-2"
        data-testid="button-wrapper"
      >
        <button
          className="p-2 rounded-lg bg-primary-container text-on-primary-container shadow-lg shadow-primary-container/20 hover:scale-105 active:scale-95 transition-all"
          aria-label="send"
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            send
          </span>
        </button>
      </div>
    </div>
  </footer>
)

export default MessageInput
