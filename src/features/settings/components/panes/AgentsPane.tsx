import {
  useCallback,
  useEffect,
  useState,
  useRef,
  type ReactElement,
} from 'react'
import type { AgentAlias, SettingsPaneTargetProps } from '../../types'
import { DEFAULT_ALIASES, SETTINGS_TARGET_IDS } from '../../sections'
import { useSettings } from '../../hooks/useSettings'
import { Icon } from '../Icon'
import { IconButton } from '@/components/IconButton'
import {
  GhostButton,
  PaneTitle,
  Row,
  Select,
  TextInput,
  Toggle,
} from '../controls'

export const AgentsPane = ({
  activeTargetId = null,
}: SettingsPaneTargetProps): ReactElement => {
  const { settings, update } = useSettings()
  const shimOn = settings.agentShimEnabled
  const [aliases, setAliases] = useState<AgentAlias[]>([])
  const [isInitializing, setIsInitializing] = useState(true)
  const [saveError, setSaveError] = useState<string | null>(null)
  const hasInteractedRef = useRef(false)
  const saveInFlightRef = useRef(false)
  const pendingSaveRef = useRef<AgentAlias[] | null>(null)

  const shellAliasesActive =
    activeTargetId === SETTINGS_TARGET_IDS.agentsShellAliases

  useEffect(() => {
    const load = async (): Promise<void> => {
      const bridge = window.vimeflow?.aliases

      if (!bridge) {
        setAliases(DEFAULT_ALIASES)
        setIsInitializing(false)

        return
      }

      try {
        const loadedAliases = await bridge.load()

        if (!hasInteractedRef.current) {
          setAliases(loadedAliases)
        }
      } catch {
        if (!hasInteractedRef.current) {
          setAliases(DEFAULT_ALIASES)
        }
      } finally {
        setIsInitializing(false)
      }
    }

    void load()
  }, [])

  const saveAliases = useCallback(async (next: AgentAlias[]): Promise<void> => {
    const bridge = window.vimeflow?.aliases

    if (!bridge) {
      setSaveError('Alias bridge is not available')

      return
    }

    try {
      await bridge.save(next)
      setSaveError(null)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to save aliases'
      setSaveError(message)
    }
  }, [])

  const flushPendingSave = useCallback((): void => {
    if (saveInFlightRef.current || pendingSaveRef.current === null) {
      return
    }

    const next = pendingSaveRef.current
    pendingSaveRef.current = null
    saveInFlightRef.current = true

    void (async (): Promise<void> => {
      try {
        await saveAliases(next)
      } finally {
        saveInFlightRef.current = false
        flushPendingSave()
      }
    })()
  }, [saveAliases])

  const setAliasesAndPersist = useCallback(
    (next: AgentAlias[]): void => {
      hasInteractedRef.current = true
      setAliases(next)
      pendingSaveRef.current = next
      flushPendingSave()
    },
    [flushPendingSave]
  )

  const addAlias = (): void => {
    const next = [
      ...aliases,
      {
        id: `a${crypto.randomUUID()}`,
        alias: '',
        agent: 'claude',
        extra: '',
        account: null,
      },
    ]

    void setAliasesAndPersist(next)
  }

  const updateAlias = (
    id: string,
    key: keyof AgentAlias,
    value: string
  ): void => {
    const next = aliases.map((a) => (a.id === id ? { ...a, [key]: value } : a))

    void setAliasesAndPersist(next)
  }

  const remove = (id: string): void => {
    const next = aliases.filter((a) => a.id !== id)

    void setAliasesAndPersist(next)
  }

  return (
    <>
      <PaneTitle title="Coding Agents" sub="Command aliases · agent registry" />

      <Row
        label="Manage agent shell aliases"
        hint="Vimeflow injects these into each pane's PTY environment. Your .bashrc / .zshrc is never touched."
        settingsTargetId={SETTINGS_TARGET_IDS.agentsManageAliases}
        settingsTargetActive={
          activeTargetId === SETTINGS_TARGET_IDS.agentsManageAliases
        }
      >
        <Toggle
          on={shimOn}
          onChange={(value): void => update({ agentShimEnabled: value })}
          aria-label="Manage agent shell aliases"
        />
      </Row>

      <div
        data-testid={`settings-target-${SETTINGS_TARGET_IDS.agentsShellAliases}`}
        data-settings-target={SETTINGS_TARGET_IDS.agentsShellAliases}
        data-settings-target-active={shellAliasesActive ? 'true' : undefined}
        tabIndex={-1}
        className={`mt-4 scroll-mt-4 rounded-lg outline-none transition-colors focus-visible:ring-1 focus-visible:ring-primary/65 ${
          shellAliasesActive ? 'bg-primary-container/[0.08]' : ''
        }`}
      >
        <div className="mb-2.5 flex items-center">
          <div>
            <div className="font-display text-sm font-medium text-on-surface">
              Shell aliases
            </div>
            <div className="mt-1 font-body text-xs text-on-surface-muted">
              New and restarted panes load these aliases. Choose an agent alias
              when starting a session and Vimeflow remembers it when resuming.
            </div>
          </div>

          <span className="min-w-0 flex-1" />

          <GhostButton onClick={addAlias} disabled={isInitializing}>
            <Icon name="add" size={12} className="mr-1 align-middle" />
            Add alias
          </GhostButton>
        </div>

        <div className="grid grid-cols-[80px_120px_1fr_30px] gap-2 px-3 pb-2 font-mono text-[10px] uppercase tracking-widest text-on-surface-muted">
          <span>Alias</span>
          <span>Agent</span>
          <span>Command / flags</span>
          <span />
        </div>

        <div
          className="overflow-hidden rounded-lg border border-outline-variant/30 bg-surface-container-lowest/50"
          aria-busy={isInitializing}
        >
          {isInitializing && (
            <div className="col-span-4 px-3 py-4 font-body text-xs text-on-surface-muted">
              Loading aliases…
            </div>
          )}

          {aliases.map((a, i) => (
            <div
              key={a.id}
              data-testid="alias-row"
              className={`grid grid-cols-[80px_120px_1fr_30px] items-center gap-2 px-3 py-2.5 ${
                i === aliases.length - 1
                  ? ''
                  : 'border-b border-outline-variant/15'
              } ${shimOn ? '' : 'opacity-45'}`}
            >
              <fieldset
                disabled={!shimOn || isInitializing}
                className="contents"
              >
                <TextInput
                  width="100%"
                  mono
                  placeholder="cc"
                  value={a.alias}
                  onChange={(v) => updateAlias(a.id, 'alias', v)}
                  aria-label={`Alias for ${a.agent}`}
                />
                <Select
                  width="100%"
                  value={a.agent}
                  onChange={(v) => updateAlias(a.id, 'agent', v)}
                  aria-label={`Agent for ${a.alias || 'new alias'}`}
                  options={[
                    { id: 'claude', label: 'Claude Code' },
                    { id: 'codex', label: 'Codex CLI' },
                    { id: 'kimi', label: 'Kimi' },
                    { id: 'opencode', label: 'OpenCode' },
                    { id: 'shell', label: 'Custom command' },
                  ]}
                />
                <TextInput
                  width="100%"
                  mono
                  placeholder={
                    a.agent === 'shell'
                      ? 'lazygit'
                      : '--dangerously-skip-permissions'
                  }
                  value={a.extra}
                  onChange={(v) => updateAlias(a.id, 'extra', v)}
                  aria-label={`Command or flags for ${a.agent}`}
                />
                <IconButton
                  icon="delete"
                  label="Remove alias"
                  size="sm"
                  variant="ghost"
                  tooltipPlacement="bottom"
                  onClick={() => remove(a.id)}
                  className="hover:bg-tertiary/10 hover:text-tertiary"
                  data-testid="remove-alias"
                />
              </fieldset>
            </div>
          ))}
        </div>

        {saveError && (
          <div
            className="mt-2.5 flex items-center gap-2 font-body text-xs text-error"
            role="alert"
            data-testid="alias-save-error"
          >
            <Icon name="error" size={14} />
            <span>{saveError}</span>
          </div>
        )}

        <div className="mt-2.5 font-mono text-[10.5px] text-on-surface-muted">
          Try it: after editing an alias, open a new pane or restart an existing
          pane. Then type{' '}
          <span className="text-primary-container">
            cc &quot;fix the auth bug&quot;
          </span>{' '}
          — agent entries prepend their executable; Custom command runs the
          command entered above.
        </div>
      </div>

      <div className="mt-6 flex items-start gap-3 rounded-lg border border-secondary/22 bg-secondary/[0.06] p-3.5">
        <Icon name="info" size={14} className="mt-0.5 text-secondary" />
        <div className="font-body text-[12.5px] leading-relaxed text-on-surface-variant">
          <strong className="font-semibold text-secondary">
            How this works.
          </strong>{' '}
          Aliases are scoped to Vimeflow&apos;s PTY layer. They live in{' '}
          <code className="rounded bg-surface-container-lowest/60 px-[5px] py-px font-mono text-[11.5px] text-primary">
            ~/.config/vimeflow/aliases.toml
          </code>{' '}
          and are injected into each pane&apos;s process environment via a tiny
          shim when that pane starts. Your real shell rc files stay untouched,
          so the aliases don&apos;t leak into other terminals.
        </div>
      </div>
    </>
  )
}
