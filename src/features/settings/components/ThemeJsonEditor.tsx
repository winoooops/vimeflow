import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactElement,
} from 'react'
import { Button } from '@/components/Button'
import { Dialog } from '@/components/Dialog'
import { writeClipboardText } from '@/lib/clipboard'
import {
  parseThemeJson,
  serializeTheme,
  themeService,
  themeToScheme,
  type ThemeDefinition,
  type ThemeScheme,
} from '@/theme'

export type ThemeJsonEditorMode = 'create' | 'import' | 'export' | 'edit'

interface ThemeJsonEditorProps {
  mode: ThemeJsonEditorMode
  theme?: ThemeDefinition
  onClose: () => void
}

const modeTitle: Record<ThemeJsonEditorMode, string> = {
  create: 'New color scheme',
  import: 'Import theme',
  export: 'Export theme',
  edit: 'Edit theme',
}

const createStarterScheme = (theme: ThemeDefinition): ThemeScheme => {
  const existingIds = new Set(
    themeService.list().map((candidate) => candidate.id)
  )
  let id = 'new-color-scheme'
  let suffix = 2

  while (existingIds.has(id)) {
    id = `new-color-scheme-${suffix}`
    suffix += 1
  }

  return {
    ...themeToScheme(theme),
    id,
    label: 'New Color Scheme',
  }
}

const createBuiltInFork = (theme: ThemeDefinition): ThemeScheme => {
  const existingIds = new Set(
    themeService.list().map((candidate) => candidate.id)
  )
  const baseId = `${theme.id}-custom`
  let id = baseId
  let suffix = 2

  while (existingIds.has(id)) {
    id = `${baseId}-${suffix}`
    suffix += 1
  }

  return {
    ...themeToScheme(theme),
    id,
    label: `${theme.label} Custom`,
  }
}

const schemeForMode = (
  mode: ThemeJsonEditorMode,
  theme: ThemeDefinition
): ThemeScheme => {
  if (mode === 'create') {
    return createStarterScheme(theme)
  }

  if (mode === 'edit' && themeService.isBuiltIn(theme.id)) {
    return createBuiltInFork(theme)
  }

  return themeToScheme(theme)
}

const hasCustomThemeIdCollision = (id: string): boolean =>
  themeService
    .list()
    .some((candidate) => candidate.id === id && !themeService.isBuiltIn(id))

const initialText = (
  mode: ThemeJsonEditorMode,
  theme: ThemeDefinition | undefined
): string => {
  if (theme === undefined) {
    return ''
  }

  return serializeTheme(schemeForMode(mode, theme))
}

const downloadJson = (theme: ThemeDefinition, text: string): void => {
  const url = URL.createObjectURL(
    new Blob([text], { type: 'application/json;charset=utf-8' })
  )
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${theme.id}.theme.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

export const ThemeJsonEditor = ({
  mode,
  theme = undefined,
  onClose,
}: ThemeJsonEditorProps): ReactElement => {
  const [text, setText] = useState(initialText(mode, theme))
  const [error, setError] = useState<string | null>(null)
  const [copyLabel, setCopyLabel] = useState('Copy')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const title = modeTitle[mode]
  const readOnly = mode === 'export'

  useEffect(() => {
    setText(initialText(mode, theme))
    setError(null)
    setCopyLabel('Copy')
  }, [mode, theme])

  const apply = (): void => {
    try {
      const parsed = parseThemeJson(text)

      const expectedEditId =
        mode === 'edit' && theme !== undefined
          ? schemeForMode(mode, theme).id
          : undefined

      if (expectedEditId !== undefined && parsed.id !== expectedEditId) {
        throw new Error('Theme id cannot change while editing')
      }

      if (mode !== 'edit' && hasCustomThemeIdCollision(parsed.id)) {
        throw new Error('A custom theme with this id already exists')
      }

      themeService.install(parsed)
      onClose()
    } catch (applyError) {
      setError(
        applyError instanceof Error ? applyError.message : 'Invalid theme'
      )
    }
  }

  const copy = (): void => {
    const run = async (): Promise<void> => {
      const copied = await writeClipboardText(text)
      setCopyLabel(copied ? 'Copied' : 'Copy failed')
    }

    void run()
  }

  const loadFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined) {
      return
    }

    const read = async (): Promise<void> => {
      try {
        setText(await file.text())
        setError(null)
      } catch {
        setError('Could not read theme JSON')
      }
    }

    void read()
  }

  return (
    <Dialog
      open
      size="lg"
      aria-label={title}
      onOpenChange={(open): void => {
        if (!open) {
          onClose()
        }
      }}
    >
      <Dialog.Header>
        <h2 className="font-display text-base font-semibold text-on-surface">
          {title}
        </h2>
        <p className="mt-1 font-body text-xs text-on-surface-muted">
          Define the base palette. Interface, syntax, terminal, effect, shadow,
          and agent colors are derived automatically.
        </p>
      </Dialog.Header>

      <Dialog.Body>
        <textarea
          aria-label="Theme JSON"
          readOnly={readOnly}
          value={text}
          placeholder={
            mode === 'import' ? 'Paste color scheme JSON here' : undefined
          }
          className="h-[42vh] min-h-[180px] max-h-[360px] w-full resize-none rounded-lg border border-outline-variant/30 bg-surface-container-lowest/70 p-3 font-mono text-[11px] leading-relaxed text-on-surface outline-none focus:border-primary/60 read-only:text-on-surface-variant"
          onChange={(event): void => {
            setText(event.target.value)
            setError(null)
          }}
        />
        {error !== null && (
          <p role="alert" className="mt-2 font-mono text-[11px] text-error">
            {error}
          </p>
        )}
        {mode === 'import' && (
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            aria-label="Theme JSON file"
            onChange={loadFile}
          />
        )}
      </Dialog.Body>

      <Dialog.Footer>
        {mode === 'import' && (
          <Button
            size="sm"
            variant="ghost"
            leadingIcon="upload_file"
            onClick={(): void => fileInputRef.current?.click()}
          >
            Load JSON file
          </Button>
        )}
        {mode !== 'import' && (
          <Button size="sm" variant="ghost" onClick={copy}>
            {copyLabel}
          </Button>
        )}
        {mode === 'export' && theme !== undefined && (
          <Button
            size="sm"
            variant="ghost"
            leadingIcon="download"
            onClick={(): void => downloadJson(theme, text)}
          >
            Download JSON
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onClose}>
          {mode === 'export' ? 'Close' : 'Cancel'}
        </Button>
        {mode !== 'export' && (
          <Button size="sm" variant="primary" onClick={apply}>
            {mode === 'import'
              ? 'Import theme'
              : mode === 'create'
                ? 'Create color scheme'
                : 'Apply changes'}
          </Button>
        )}
      </Dialog.Footer>
    </Dialog>
  )
}
