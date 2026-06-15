import type { ComponentPropsWithoutRef, JSX, ReactElement } from 'react'
import type { Components } from 'react-markdown'

/**
 * Per-tag `components` map for `react-markdown`, styling every rendered element
 * with The Lens semantic Tailwind tokens (no raw hex). Headings use
 * `font-headline` + `text-on-surface`; body copy uses `text-on-surface-variant`
 * + `font-body`; links use the `text-secondary` link role; inline code and code
 * blocks use `font-mono` on `bg-surface-container-lowest`; tables and rules use
 * the `outline-variant` ghost-border token.
 *
 * Sizes are in `em` (and line-height is inherited, not set here) so the whole
 * document scales from the single base font-size the active reading-style
 * preset publishes on the container (`--rv-font-size` / `--rv-line-height` in
 * `MarkdownReadingView`). Bumping the preset bumps headings, code, and tables
 * proportionally.
 *
 * `react-markdown` passes an extra `node` prop (the hast node) to each
 * component. We strip it so it is never forwarded onto a real DOM element
 * (React would warn about an unknown `node` attribute otherwise) and spread the
 * remaining intrinsic-element props through.
 */

type IntrinsicProps<Tag extends keyof JSX.IntrinsicElements> =
  ComponentPropsWithoutRef<Tag> & { node?: unknown }

export const markdownComponents: Components = {
  h1: ({
    node: _node,
    className,
    ...props
  }: IntrinsicProps<'h1'>): ReactElement => (
    <h1
      className="mt-8 mb-3 font-headline text-[1.875em] font-bold tracking-tight text-on-surface first:mt-0"
      {...props}
    />
  ),
  h2: ({
    node: _node,
    className,
    ...props
  }: IntrinsicProps<'h2'>): ReactElement => (
    <h2
      className="mt-8 mb-3 font-headline text-[1.4em] font-semibold tracking-tight text-on-surface first:mt-0"
      {...props}
    />
  ),
  h3: ({
    node: _node,
    className,
    ...props
  }: IntrinsicProps<'h3'>): ReactElement => (
    <h3
      className="mt-6 mb-2 font-headline text-[1.18em] font-semibold text-on-surface first:mt-0"
      {...props}
    />
  ),
  h4: ({
    node: _node,
    className,
    ...props
  }: IntrinsicProps<'h4'>): ReactElement => (
    <h4
      className="mt-5 mb-2 font-headline text-[1.05em] font-semibold text-on-surface first:mt-0"
      {...props}
    />
  ),
  h5: ({
    node: _node,
    className,
    ...props
  }: IntrinsicProps<'h5'>): ReactElement => (
    <h5
      className="mt-4 mb-1 font-headline text-[0.9em] font-semibold uppercase tracking-wide text-on-surface-variant first:mt-0"
      {...props}
    />
  ),
  h6: ({
    node: _node,
    className,
    ...props
  }: IntrinsicProps<'h6'>): ReactElement => (
    <h6
      className="mt-4 mb-1 font-headline text-[0.8em] font-semibold uppercase tracking-wide text-on-surface-muted first:mt-0"
      {...props}
    />
  ),
  p: ({
    node: _node,
    className,
    ...props
  }: IntrinsicProps<'p'>): ReactElement => (
    <p className="my-[0.9em] font-body text-on-surface-variant" {...props} />
  ),
  a: ({
    node: _node,
    className,
    ...props
  }: IntrinsicProps<'a'>): ReactElement => (
    // `rel` is forced AFTER the spread so a `rel` carried on the source link
    // can never widen it back to a referrer-leaking value.
    <a
      className="text-secondary underline-offset-2 hover:underline"
      {...props}
      rel="noreferrer"
    />
  ),
  strong: ({
    node: _node,
    className,
    ...props
  }: IntrinsicProps<'strong'>): ReactElement => (
    <strong className="font-semibold text-on-surface" {...props} />
  ),
  em: ({
    node: _node,
    className,
    ...props
  }: IntrinsicProps<'em'>): ReactElement => (
    <em className="italic text-on-surface-variant" {...props} />
  ),
  ul: ({
    node: _node,
    className,
    ...props
  }: IntrinsicProps<'ul'>): ReactElement => (
    <ul
      className="my-[0.9em] list-disc space-y-1 pl-6 font-body text-on-surface-variant"
      {...props}
    />
  ),
  ol: ({
    node: _node,
    className,
    ...props
  }: IntrinsicProps<'ol'>): ReactElement => (
    <ol
      className="my-[0.9em] list-decimal space-y-1 pl-6 font-body text-on-surface-variant"
      {...props}
    />
  ),
  li: ({
    node: _node,
    className,
    ...props
  }: IntrinsicProps<'li'>): ReactElement => (
    <li className="marker:text-on-surface-muted" {...props} />
  ),
  blockquote: ({
    node: _node,
    className,
    ...props
  }: IntrinsicProps<'blockquote'>): ReactElement => (
    <blockquote
      className="my-4 border-l-2 border-outline-variant pl-4 italic text-on-surface-muted"
      {...props}
    />
  ),
  hr: ({
    node: _node,
    className,
    ...props
  }: IntrinsicProps<'hr'>): ReactElement => (
    <hr className="my-6 border-t border-outline-variant" {...props} />
  ),
  // Inline `code` only — fenced blocks render <pre><code>, where the parent
  // <pre> owns the surface/scroll and the child <code> stays transparent so
  // rehype-highlight's .hljs token colors (MarkdownReadingView.css) show through.
  code: ({
    node: _node,
    className,
    ...props
  }: IntrinsicProps<'code'>): ReactElement => {
    const isBlock = /\blanguage-/.test(className ?? '')

    if (isBlock) {
      return (
        <code
          className={`font-mono text-[0.85em] ${className ?? ''}`.trimEnd()}
          {...props}
        />
      )
    }

    return (
      <code
        className="rounded bg-surface-container-lowest px-1.5 py-0.5 font-mono text-[0.85em] text-primary"
        {...props}
      />
    )
  },
  pre: ({
    node: _node,
    className,
    ...props
  }: IntrinsicProps<'pre'>): ReactElement => (
    <pre
      className="my-4 overflow-x-auto rounded-md bg-surface-container-lowest p-4 font-mono text-[0.85em]"
      {...props}
    />
  ),
  table: ({
    node: _node,
    className,
    ...props
  }: IntrinsicProps<'table'>): ReactElement => (
    <div className="my-4 overflow-x-auto">
      <table className="w-full border-collapse text-[0.9em]" {...props} />
    </div>
  ),
  thead: ({
    node: _node,
    className,
    ...props
  }: IntrinsicProps<'thead'>): ReactElement => <thead {...props} />,
  th: ({
    node: _node,
    className,
    ...props
  }: IntrinsicProps<'th'>): ReactElement => (
    <th
      className="border-b border-outline-variant px-3 py-2 text-left font-headline font-semibold text-on-surface"
      {...props}
    />
  ),
  td: ({
    node: _node,
    className,
    ...props
  }: IntrinsicProps<'td'>): ReactElement => (
    <td
      className="border-b border-outline-variant px-3 py-2 align-top text-on-surface-variant"
      {...props}
    />
  ),
  img: ({
    node: _node,
    className,
    ...props
  }: IntrinsicProps<'img'>): ReactElement => (
    <img className="my-4 max-w-full rounded-md" {...props} />
  ),
}
