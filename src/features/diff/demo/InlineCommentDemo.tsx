import { useCallback, useMemo, useState, type ReactElement } from 'react'
import { MultiFileDiff } from '@pierre/diffs/react'
import type { AnnotationSide, DiffLineAnnotation } from '@pierre/diffs'
import {
  useFeedbackBatch,
  DRAFT_ID,
  type ReviewComment,
} from '../hooks/useFeedbackBatch'
import { ReviewCommentComposer } from '../components/ReviewCommentComposer'
import { ReviewCommentRow } from '../components/ReviewCommentRow'

// Dev-only interactive demo justifying the PR4 "gutter affordance" approach to
// adding inline review comments (spec §7), matching the Codex inline-composer
// UX: a `+` in the gutter on hover opens a FULL-WIDTH composer panel BELOW the
// line (via Pierre's `renderAnnotation` slot, driven by a transient draft
// annotation) — not a floating popover. Wires the real Pierre
// `renderGutterUtility` + `getHoveredLine` API to the real
// ReviewCommentComposer / ReviewCommentRow / useFeedbackBatch (Tasks 4.1–4.2).
// Launch: `npm run dev` → http://localhost:5173/?demo=inline-comments

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

// Which line currently has an open composer. `editId` set => editing an
// existing comment in place; absent => a new draft on that line.
interface ComposerTarget {
  lineNumber: number
  side: AnnotationSide
  editId?: string
}

/**
 * InlineCommentDemo - dev harness for the Codex-style gutter-comment flow.
 */
export const InlineCommentDemo = (): ReactElement => {
  const feedback = useFeedbackBatch()
  const [target, setTarget] = useState<ComposerTarget | null>(null)

  const realAnnotations = feedback.annotationsForFile(
    DEMO_CWD,
    DEMO_FILE,
    false
  )

  // Merge a transient draft annotation in only while composing a NEW comment,
  // so the composer renders inline below the target line. Editing reuses the
  // existing annotation's slot, so no draft is added there. When idle we pass
  // `realAnnotations` straight through to keep its identity stable (avoids
  // Pierre re-tokenizing on every render).
  const lineAnnotations = useMemo((): DiffLineAnnotation<ReviewComment>[] => {
    if (target !== null && target.editId === undefined) {
      const draft: DiffLineAnnotation<ReviewComment> = {
        side: target.side,
        lineNumber: target.lineNumber,
        metadata: { id: DRAFT_ID, text: '', author: 'self', createdAt: 0 },
      }

      return [...realAnnotations, draft]
    }

    return realAnnotations
  }, [realAnnotations, target])

  const confirmComposer = useCallback(
    (text: string): void => {
      setTarget((current) => {
        if (current === null) {
          return null
        }

        if (current.editId !== undefined) {
          feedback.updateAnnotation(
            DEMO_CWD,
            DEMO_FILE,
            false,
            current.editId,
            {
              text,
            }
          )
        } else {
          feedback.addAnnotation(DEMO_CWD, DEMO_FILE, false, {
            side: current.side,
            lineNumber: current.lineNumber,
            metadata: {
              id: nextCommentId(),
              text,
              author: 'self',
              createdAt: Date.now(),
            },
          })
        }

        return null
      })
    },
    [feedback]
  )

  const closeComposer = useCallback((): void => {
    setTarget(null)
  }, [])

  return (
    <div className="flex h-screen w-screen flex-col bg-surface text-on-surface">
      <header className="shrink-0 px-4 py-3">
        <h1 className="font-headline text-sm font-semibold">
          Inline review comments — gutter affordance demo
        </h1>
        <p className="text-on-surface-variant text-xs">
          Hover a diff line, click the + in the gutter, type a comment, press
          Enter. {feedback.totalAnnotations()} comment(s) in the batch.
        </p>
      </header>
      <div className="thin-scrollbar min-h-0 flex-1 overflow-auto px-4 pb-8">
        <MultiFileDiff
          oldFile={{ name: DEMO_FILE, contents: OLD_CONTENTS }}
          newFile={{ name: DEMO_FILE, contents: NEW_CONTENTS }}
          // `enableGutterUtility` is REQUIRED to activate Pierre's per-line
          // hover tracking + render the gutter slot — without it
          // `handlePointerMove` ignores hover and the + button never appears
          // (the `renderGutterUtility` prop alone does nothing). See
          // node_modules/@pierre/diffs/dist/managers/InteractionManager.js.
          options={{
            diffStyle: 'unified',
            theme: 'pierre-dark',
            enableGutterUtility: true,
          }}
          lineAnnotations={lineAnnotations}
          renderGutterUtility={(getHoveredLine): ReactElement => (
            // translate-x-3/4 shifts the "+" out of the line-number cell into the
            // gutter gap next to the code (GitHub-style) — Pierre otherwise
            // center-anchors it on top of the number. Mirrors DiffPanelContent.
            <button
              type="button"
              aria-label="Add comment on this line"
              className="flex h-5 w-5 translate-x-3/4 items-center justify-center rounded-full bg-primary text-on-primary shadow-md hover:bg-primary/90"
              onClick={(): void => {
                const hovered = getHoveredLine()
                if (hovered) {
                  setTarget({
                    lineNumber: hovered.lineNumber,
                    side: hovered.side,
                  })
                }
              }}
            >
              <span
                aria-hidden="true"
                className="material-symbols-outlined text-sm leading-none"
              >
                add
              </span>
            </button>
          )}
          renderAnnotation={(
            annotation: DiffLineAnnotation<ReviewComment>
          ): ReactElement => {
            const isDraft = annotation.metadata.id === DRAFT_ID

            const isEditing =
              target?.editId !== undefined &&
              target.editId === annotation.metadata.id

            if (isDraft || isEditing) {
              return (
                <ReviewCommentComposer
                  lineNumber={annotation.lineNumber}
                  side={annotation.side}
                  initialText={isEditing ? annotation.metadata.text : ''}
                  onConfirm={confirmComposer}
                  onCancel={closeComposer}
                />
              )
            }

            return (
              <ReviewCommentRow
                comment={annotation.metadata}
                onEdit={(): void =>
                  setTarget({
                    lineNumber: annotation.lineNumber,
                    side: annotation.side,
                    editId: annotation.metadata.id,
                  })
                }
                onDelete={(): void =>
                  feedback.removeAnnotation(
                    DEMO_CWD,
                    DEMO_FILE,
                    false,
                    annotation.metadata.id
                  )
                }
              />
            )
          }}
          style={{ display: 'block', width: '100%' }}
        />
      </div>
    </div>
  )
}
