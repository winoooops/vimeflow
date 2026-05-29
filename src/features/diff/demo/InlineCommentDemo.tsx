import { useCallback, useRef, useState, type ReactElement } from 'react'
import { MultiFileDiff } from '@pierre/diffs/react'
import type { AnnotationSide, DiffLineAnnotation } from '@pierre/diffs'
import { useFeedbackBatch, type ReviewComment } from '../hooks/useFeedbackBatch'
import { ReviewCommentComposer } from '../components/ReviewCommentComposer'
import { ReviewCommentRow } from '../components/ReviewCommentRow'

// Dev-only interactive demo justifying the PR4 "gutter affordance" approach to
// adding inline review comments (spec §7). It wires the REAL Pierre
// `renderGutterUtility` + `getHoveredLine` API (the only per-line interaction
// hook `<MultiFileDiff>` exposes — there is no `onDiffLineClick`) to the real
// ReviewCommentComposer / ReviewCommentRow / useFeedbackBatch built in Tasks
// 4.1–4.2, so hovering a line, clicking the gutter 💬, and seeing the comment
// render inline can be validated by hand before the full DiffPanelContent
// integration (Task 4.5). Launch via `npm run dev` → `?demo=inline-comments`.

const DEMO_CWD = '/demo'
const DEMO_FILE = 'greet.ts'

const OLD_CONTENTS = `export function greet(name) {
  const msg = 'Hello, ' + name
  console.log(msg)
  return msg
}
`

const NEW_CONTENTS = `export function greet(name: string): string {
  const msg = \`Hello, \${name}!\`
  logger.info(msg)
  return msg
}
`

// Monotonic id source. A module counter keeps comment ids stable + unique
// without reaching for Date.now()/Math.random() in render.
let commentSeq = 0
const nextCommentId = (): string => `demo-comment-${(commentSeq += 1)}`

interface ComposerState {
  anchor: HTMLElement
  side: AnnotationSide
  lineNumber: number
  editId?: string
  initialText: string
}

/**
 * InlineCommentDemo - dev harness for the gutter-comment interaction.
 */
export const InlineCommentDemo = (): ReactElement => {
  const feedback = useFeedbackBatch()
  const [composer, setComposer] = useState<ComposerState | null>(null)

  const annotations = feedback.annotationsForFile(DEMO_CWD, DEMO_FILE)

  const openAddComposer = useCallback(
    (anchor: HTMLElement, lineNumber: number, side: AnnotationSide): void => {
      setComposer({ anchor, side, lineNumber, initialText: '' })
    },
    []
  )

  const openEditComposer = useCallback(
    (
      anchor: HTMLElement,
      annotation: DiffLineAnnotation<ReviewComment>
    ): void => {
      setComposer({
        anchor,
        side: annotation.side,
        lineNumber: annotation.lineNumber,
        editId: annotation.metadata.id,
        initialText: annotation.metadata.text,
      })
    },
    []
  )

  const confirmComposer = useCallback(
    (text: string): void => {
      if (composer === null) {
        return
      }

      if (composer.editId !== undefined) {
        feedback.updateAnnotation(DEMO_CWD, DEMO_FILE, composer.editId, {
          text,
        })
      } else {
        const comment: ReviewComment = {
          id: nextCommentId(),
          text,
          author: 'self',
          createdAt: Date.now(),
        }
        feedback.addAnnotation(DEMO_CWD, DEMO_FILE, {
          side: composer.side,
          lineNumber: composer.lineNumber,
          metadata: comment,
        })
      }

      setComposer(null)
    },
    [composer, feedback]
  )

  const closeComposer = useCallback((): void => {
    setComposer(null)
  }, [])

  return (
    <div className="flex h-screen w-screen flex-col bg-surface text-on-surface">
      <header className="shrink-0 px-4 py-3">
        <h1 className="font-headline text-sm font-semibold">
          Inline review comments — gutter affordance demo
        </h1>
        <p className="text-on-surface-variant text-xs">
          Hover a diff line, click the 💬 in the gutter, type a comment, press
          Enter. {feedback.totalAnnotations()} comment(s) in the batch.
        </p>
      </header>
      <div className="thin-scrollbar min-h-0 flex-1 overflow-auto px-4 pb-8">
        <MultiFileDiff
          oldFile={{ name: DEMO_FILE, contents: OLD_CONTENTS }}
          newFile={{ name: DEMO_FILE, contents: NEW_CONTENTS }}
          // `enableGutterUtility` is REQUIRED to activate Pierre's per-line
          // hover tracking + render the gutter slot — without it
          // `handlePointerMove` ignores hover and the 💬 button never appears
          // (the `renderGutterUtility` prop alone does nothing). See
          // node_modules/@pierre/diffs/dist/managers/InteractionManager.js.
          options={{
            diffStyle: 'unified',
            theme: 'pierre-dark',
            enableGutterUtility: true,
          }}
          lineAnnotations={annotations}
          renderGutterUtility={(getHoveredLine): ReactElement => (
            <button
              type="button"
              aria-label="Add comment on this line"
              className="flex h-5 w-5 items-center justify-center rounded bg-primary/80 text-on-primary hover:bg-primary"
              onClick={(event): void => {
                const hovered = getHoveredLine()
                if (hovered) {
                  openAddComposer(
                    event.currentTarget,
                    hovered.lineNumber,
                    hovered.side
                  )
                }
              }}
            >
              <span
                aria-hidden="true"
                className="material-symbols-outlined text-sm leading-none"
              >
                add_comment
              </span>
            </button>
          )}
          renderAnnotation={(
            annotation: DiffLineAnnotation<ReviewComment>
          ): ReactElement => (
            <AnnotationRow
              annotation={annotation}
              onEdit={openEditComposer}
              onDelete={(): void =>
                feedback.removeAnnotation(
                  DEMO_CWD,
                  DEMO_FILE,
                  annotation.metadata.id
                )
              }
            />
          )}
          style={{ display: 'block', width: '100%' }}
        />
      </div>
      {composer !== null ? (
        <ReviewCommentComposer
          anchor={composer.anchor}
          initialText={composer.initialText}
          onConfirm={confirmComposer}
          onCancel={closeComposer}
        />
      ) : null}
    </div>
  )
}

// Small wrapper so the edit affordance can capture its own DOM element as the
// composer anchor (ReviewCommentRow is anchor-agnostic by design).
interface AnnotationRowProps {
  annotation: DiffLineAnnotation<ReviewComment>
  onEdit: (
    anchor: HTMLElement,
    annotation: DiffLineAnnotation<ReviewComment>
  ) => void
  onDelete: () => void
}

const AnnotationRow = ({
  annotation,
  onEdit,
  onDelete,
}: AnnotationRowProps): ReactElement => {
  const ref = useRef<HTMLDivElement>(null)

  return (
    <div ref={ref}>
      <ReviewCommentRow
        comment={annotation.metadata}
        onEdit={(): void => {
          if (ref.current) {
            onEdit(ref.current, annotation)
          }
        }}
        onDelete={onDelete}
      />
    </div>
  )
}
