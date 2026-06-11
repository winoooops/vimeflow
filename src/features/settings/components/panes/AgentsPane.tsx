import { useState, type ReactElement } from 'react'
import type { AgentAlias } from '../../types'
import { DEFAULT_ALIASES } from '../../sections'
import { Icon } from '../Icon'
import {
  GhostButton,
  PaneTitle,
  Row,
  Select,
  TextInput,
  Toggle,
} from '../controls'

export const AgentsPane = (): ReactElement => {
  const [shimOn, setShimOn] = useState(true)
  const [aliases, setAliases] = useState<AgentAlias[]>(DEFAULT_ALIASES)

  const addAlias = (): void =>
    setAliases((prev) => [
      ...prev,
      {
        id: `a${Date.now()}`,
        alias: '',
        agent: 'claude',
        model: 'sonnet-4',
        extra: '',
      },
    ])

  const update = (id: string, key: keyof AgentAlias, value: string): void =>
    setAliases((prev) =>
      prev.map((a) => (a.id === id ? { ...a, [key]: value } : a))
    )

  const remove = (id: string): void =>
    setAliases((prev) => prev.filter((a) => a.id !== id))

  return (
    <>
      <PaneTitle title="Coding Agents" sub="Shell aliases · agent registry" />

      <Row
        label="Manage agent shell aliases"
        hint="Vimeflow injects these into each pane's PTY environment. Your .bashrc / .zshrc is never touched."
      >
        <Toggle
          on={shimOn}
          onChange={setShimOn}
          aria-label="Manage agent shell aliases"
        />
      </Row>

      <div className="mt-4">
        <div className="mb-2.5 flex items-center">
          <div>
            <div className="font-display text-sm font-medium text-on-surface">
              Shell aliases
            </div>
            <div className="mt-1 font-body text-xs text-on-surface-muted">
              Type the alias in any pane and Vimeflow swaps it for the full
              agent invocation.
            </div>
          </div>

          <span className="min-w-0 flex-1" />

          <GhostButton onClick={addAlias}>
            <Icon name="add" size={12} className="mr-1 align-middle" />
            Add alias
          </GhostButton>
        </div>

        <div className="grid grid-cols-[80px_120px_140px_1fr_30px] gap-2 px-3 pb-2 font-mono text-[10px] uppercase tracking-widest text-on-surface-muted">
          <span>Alias</span>
          <span>Agent</span>
          <span>Model</span>
          <span>Extra flags</span>
          <span />
        </div>

        <div className="overflow-hidden rounded-lg border border-outline-variant/30 bg-surface-container-lowest/50">
          {aliases.map((a, i) => (
            <div
              key={a.id}
              data-testid="alias-row"
              className={`grid grid-cols-[80px_120px_140px_1fr_30px] items-center gap-2 px-3 py-2.5 ${
                i === aliases.length - 1
                  ? ''
                  : 'border-b border-outline-variant/15'
              } ${shimOn ? '' : 'opacity-45'}`}
            >
              <TextInput
                width="100%"
                mono
                placeholder="cc"
                value={a.alias}
                onChange={(v) => update(a.id, 'alias', v)}
                aria-label={`Alias for ${a.agent}`}
              />
              <Select
                width="100%"
                value={a.agent}
                onChange={(v) => update(a.id, 'agent', v)}
                aria-label={`Agent for ${a.alias || 'new alias'}`}
                options={[
                  { id: 'claude', label: 'Claude Code' },
                  { id: 'codex', label: 'Codex CLI' },
                  { id: 'gemini', label: 'Gemini CLI' },
                  { id: 'shell', label: 'Shell only' },
                ]}
              />
              <Select
                width="100%"
                value={a.model}
                onChange={(v) => update(a.id, 'model', v)}
                aria-label={`Model for ${a.alias || 'new alias'}`}
                options={[
                  { id: 'sonnet-4', label: 'sonnet-4' },
                  { id: 'opus-4', label: 'opus-4' },
                  { id: 'gpt-5-codex', label: 'gpt-5-codex' },
                  { id: 'gemini-2.5', label: 'gemini-2.5' },
                ]}
              />
              <TextInput
                width="100%"
                mono
                placeholder="--continue"
                value={a.extra}
                onChange={(v) => update(a.id, 'extra', v)}
                aria-label={`Extra flags for ${a.agent}`}
              />
              <button
                type="button"
                title="Remove alias"
                onClick={() => remove(a.id)}
                className="grid h-[22px] w-[22px] place-items-center rounded border-none bg-transparent text-on-surface-muted transition-colors hover:bg-tertiary/10 hover:text-tertiary"
                data-testid="remove-alias"
              >
                <Icon name="delete" size={13} />
              </button>
            </div>
          ))}
        </div>

        <div className="mt-2.5 font-mono text-[10.5px] text-on-surface-muted">
          Try it: in any pane, type{' '}
          <span className="text-primary-container">
            cc &quot;fix the auth bug&quot;
          </span>{' '}
          — Vimeflow expands it to the full agent invocation before sending to
          the PTY.
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
          shim. Your real shell rc files stay untouched, so the aliases
          don&apos;t leak into other terminals.
        </div>
      </div>
    </>
  )
}
