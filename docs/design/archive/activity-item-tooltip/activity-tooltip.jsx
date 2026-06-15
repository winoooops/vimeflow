// Vimeflow — Activity tooltip: a richer hover card for activity feed rows.
// Replaces the original two-row "BASH / [COPY] / command" tooltip with a
// proper card: kind chip + metadata pips in the header, a typed body
// (command + output for bash, diff for edit, etc.), and a quiet keyboard
// hint footer.

;(function () {
  // Kind metadata: name + agent-tinted accent + icon.
  const KIND = {
    bash: { label: 'bash', icon: 'terminal', accent: '#a8c8ff' },
    edit: { label: 'edit', icon: 'edit', accent: '#e2c7ff' },
    read: { label: 'read', icon: 'visibility', accent: '#8a8299' },
    think: { label: 'think', icon: 'psychology', accent: '#c39eee' },
    user: { label: 'user', icon: 'person', accent: '#f0c674' },
    tool: { label: 'tool', icon: 'build', accent: '#a8c8ff' },
  }

  function ActivityTooltip({ kind = 'bash', meta = {}, body = {}, onCopy }) {
    const k = KIND[kind] || KIND.bash
    const [copied, setCopied] = React.useState(false)

    const handleCopy = () => {
      const txt = body.command || body.file || body.text || ''
      try {
        navigator.clipboard?.writeText(txt)
      } catch (e) {}
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
      onCopy && onCopy(txt)
    }

    return (
      <div
        role="tooltip"
        style={{
          width: 380,
          background: 'rgba(20, 18, 32, 0.96)',
          backdropFilter: 'blur(20px) saturate(150%)',
          WebkitBackdropFilter: 'blur(20px) saturate(150%)',
          border: '1px solid rgba(74,68,79,0.45)',
          borderRadius: 10,
          boxShadow:
            '0 16px 48px rgba(0,0,0,0.55), 0 0 0 1px rgba(203,166,247,0.04)',
          overflow: 'hidden',
          fontFamily: "'Inter', sans-serif",
          position: 'relative',
        }}
      >
        {/* Accent stripe — kind-tinted top edge */}
        <span
          style={{
            position: 'absolute',
            left: 12,
            right: 12,
            top: 0,
            height: 2,
            background: `linear-gradient(90deg, transparent, ${k.accent}, transparent)`,
            opacity: 0.55,
          }}
        />

        {/* Header: kind chip + meta pips + copy */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 10px 8px 12px',
          }}
        >
          {/* Kind chip */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              height: 20,
              padding: '0 8px 0 6px',
              background: `${k.accent}1f`, // 12% alpha
              border: `1px solid ${k.accent}3d`, // 24% alpha
              borderRadius: 5,
              color: k.accent,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'lowercase',
            }}
          >
            <window.Icon name={k.icon} size={11} />
            {k.label}
          </div>

          {/* Meta pips */}
          {meta.ago && (
            <Pip>
              <Dot />
              {meta.ago}
            </Pip>
          )}
          {kind === 'bash' && meta.exit != null && (
            <Pip tone={meta.exit === 0 ? 'success' : 'warn'}>
              <span
                style={{
                  color: meta.exit === 0 ? '#7defa1' : '#ff94a5',
                }}
              >
                ●
              </span>
              exit {meta.exit}
            </Pip>
          )}
          {meta.duration && <Pip>{meta.duration}</Pip>}
          {kind === 'edit' && (meta.add != null || meta.rem != null) && (
            <Pip>
              {meta.add != null && (
                <span style={{ color: '#7defa1' }}>+{meta.add}</span>
              )}
              {meta.rem != null && (
                <span style={{ color: '#ff94a5', marginLeft: 4 }}>
                  −{meta.rem}
                </span>
              )}
            </Pip>
          )}
          {kind === 'read' && meta.lines && <Pip>{meta.lines}</Pip>}
          {kind === 'read' && meta.tokens != null && (
            <Pip>{meta.tokens.toLocaleString()}t</Pip>
          )}

          <span style={{ flex: 1 }} />

          {/* Copy icon button */}
          <button
            onClick={handleCopy}
            title={copied ? 'Copied' : 'Copy'}
            style={{
              width: 22,
              height: 22,
              borderRadius: 4,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: copied ? '#7defa1' : '#8a8299',
              display: 'grid',
              placeItems: 'center',
              transition: 'color 160ms ease, background 160ms ease',
            }}
            onMouseEnter={(e) => {
              if (!copied) {
                e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
                e.currentTarget.style.color = '#e2c7ff'
              }
            }}
            onMouseLeave={(e) => {
              if (!copied) {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.color = '#8a8299'
              }
            }}
          >
            <window.Icon name={copied ? 'check' : 'content_copy'} size={12} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '4px 14px 12px' }}>
          <BodyForKind kind={kind} body={body} accent={k.accent} />
        </div>

        {/* Footer hint — only when there are actions */}
        {(kind === 'bash' || kind === 'edit' || kind === 'read') && (
          <div
            style={{
              padding: '7px 14px',
              background: 'rgba(13,13,28,0.6)',
              borderTop: '1px solid rgba(74,68,79,0.25)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 9.5,
              color: '#6c7086',
              letterSpacing: '0.04em',
            }}
          >
            {kind === 'bash' && (
              <>
                <window.Kbd>↵</window.Kbd> rerun <window.Kbd>⌘</window.Kbd>
                <window.Kbd>O</window.Kbd> open in terminal
              </>
            )}
            {kind === 'edit' && (
              <>
                <window.Kbd>⌘</window.Kbd>
                <window.Kbd>O</window.Kbd> open file <window.Kbd>⌘</window.Kbd>
                <window.Kbd>D</window.Kbd> view diff
              </>
            )}
            {kind === 'read' && (
              <>
                <window.Kbd>⌘</window.Kbd>
                <window.Kbd>O</window.Kbd> open file
              </>
            )}
            <span style={{ flex: 1 }} />
            <span style={{ color: '#4a444f' }}>esc</span>
          </div>
        )}
      </div>
    )
  }

  function Pip({ children, tone }) {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 10,
          color: '#8a8299',
          whiteSpace: 'nowrap',
        }}
      >
        {children}
      </span>
    )
  }
  function Dot() {
    return <span style={{ color: '#4a444f', marginRight: 1 }}>·</span>
  }

  // ---------- per-kind body renderers --------------------------------------

  function BodyForKind({ kind, body, accent }) {
    if (kind === 'bash') return <BodyBash body={body} accent={accent} />
    if (kind === 'edit') return <BodyEdit body={body} accent={accent} />
    if (kind === 'read') return <BodyRead body={body} accent={accent} />
    if (kind === 'think') return <BodyThink body={body} accent={accent} />
    if (kind === 'user') return <BodyUser body={body} accent={accent} />
    if (kind === 'tool') return <BodyTool body={body} accent={accent} />
    return null
  }

  function BodyBash({ body, accent }) {
    return (
      <>
        <CommandBlock cmd={body.command || ''} accent={accent} />
        {body.output && body.output.length > 0 && (
          <>
            <Divider label="output" />
            <pre style={preBase}>
              {body.output.slice(0, 6).map((line, i) => (
                <div
                  key={i}
                  style={{
                    color: outputColor(line),
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {line}
                </div>
              ))}
              {body.output.length > 6 && (
                <div
                  style={{
                    color: '#6c7086',
                    fontStyle: 'italic',
                    marginTop: 4,
                  }}
                >
                  … {body.output.length - 6} more lines
                </div>
              )}
            </pre>
          </>
        )}
      </>
    )
  }

  function outputColor(line) {
    if (/^\s*[✗✘❌]/.test(line) || /\b(fail|error)\b/i.test(line))
      return '#ff94a5'
    if (/^\s*[✓✔]/.test(line)) return '#7defa1'
    if (/^\s*[#>·-]/.test(line)) return '#6c7086'
    return '#cdc3d1'
  }

  function BodyEdit({ body, accent }) {
    return (
      <>
        <FilePathChip path={body.file || ''} accent={accent} />
        {(body.before || body.after) && (
          <pre style={{ ...preBase, marginTop: 8 }}>
            {(body.before || []).map((l, i) => (
              <div
                key={'b' + i}
                style={{
                  background: 'rgba(255,148,165,0.07)',
                  color: '#f38ba8',
                  padding: '1px 6px',
                  borderLeft: '2px solid rgba(255,148,165,0.4)',
                  marginBottom: 1,
                  whiteSpace: 'pre-wrap',
                }}
              >
                − {l}
              </div>
            ))}
            {(body.after || []).map((l, i) => (
              <div
                key={'a' + i}
                style={{
                  background: 'rgba(125,239,161,0.07)',
                  color: '#a6e3a1',
                  padding: '1px 6px',
                  borderLeft: '2px solid rgba(125,239,161,0.4)',
                  marginBottom: 1,
                  whiteSpace: 'pre-wrap',
                }}
              >
                + {l}
              </div>
            ))}
          </pre>
        )}
      </>
    )
  }

  function BodyRead({ body, accent }) {
    return (
      <>
        <FilePathChip path={body.file || ''} accent={accent} />
        {body.preview && (
          <pre style={{ ...preBase, marginTop: 8, color: '#8a8299' }}>
            {body.preview}
          </pre>
        )}
      </>
    )
  }

  function BodyThink({ body, accent }) {
    return (
      <div
        style={{
          fontFamily: "'Inter', sans-serif",
          fontSize: 13,
          lineHeight: 1.55,
          color: '#cdc3d1',
          fontStyle: 'italic',
          borderLeft: `2px solid ${accent}66`,
          paddingLeft: 12,
        }}
      >
        {body.text}
      </div>
    )
  }

  function BodyUser({ body, accent }) {
    return (
      <div
        style={{
          fontFamily: "'Inter', sans-serif",
          fontSize: 13,
          lineHeight: 1.55,
          color: '#e3e0f7',
        }}
      >
        {body.text}
      </div>
    )
  }

  function BodyTool({ body, accent }) {
    return (
      <pre style={preBase}>
        <span style={{ color: accent }}>{body.name}</span>
        <span style={{ color: '#6c7086' }}>(</span>
        <span style={{ color: '#f5e0dc' }}>{body.args}</span>
        <span style={{ color: '#6c7086' }}>)</span>
      </pre>
    )
  }

  // ---------- shared body pieces -------------------------------------------

  // Command block — collapses long single-line commands by wrapping with
  // the `\` continuation marker, mimicking how shells render multi-line cmds.
  function CommandBlock({ cmd, accent }) {
    return (
      <pre
        style={{
          ...preBase,
          background: 'rgba(13,13,28,0.55)',
          border: '1px solid rgba(74,68,79,0.3)',
          borderRadius: 6,
          padding: '8px 10px 8px 24px',
          position: 'relative',
          margin: 0,
        }}
      >
        <span
          style={{
            position: 'absolute',
            left: 10,
            top: 8,
            color: accent,
            opacity: 0.8,
          }}
        >
          $
        </span>
        <span
          style={{
            color: '#e3e0f7',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {cmd}
        </span>
      </pre>
    )
  }

  function FilePathChip({ path, accent }) {
    const parts = path.split('/')
    const file = parts.pop()
    const dir = parts.join('/') + '/'
    return (
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11.5,
          padding: '8px 10px',
          background: 'rgba(13,13,28,0.55)',
          border: '1px solid rgba(74,68,79,0.3)',
          borderRadius: 6,
          display: 'flex',
          alignItems: 'baseline',
          gap: 1,
        }}
      >
        <window.Icon
          name="draft"
          size={12}
          style={{
            color: accent,
            marginRight: 6,
            transform: 'translateY(2px)',
          }}
        />
        <span style={{ color: '#6c7086' }}>{dir}</span>
        <span style={{ color: '#e3e0f7', fontWeight: 600 }}>{file}</span>
      </div>
    )
  }

  function Divider({ label }) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          margin: '10px 0 6px',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 9,
          color: '#6c7086',
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
        }}
      >
        <span
          style={{ flex: 1, height: 1, background: 'rgba(74,68,79,0.3)' }}
        />
        {label}
        <span
          style={{ flex: 1, height: 1, background: 'rgba(74,68,79,0.3)' }}
        />
      </div>
    )
  }

  const preBase = {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 11,
    lineHeight: 1.55,
    margin: 0,
    padding: 0,
    color: '#cdc3d1',
    overflow: 'hidden',
  }

  window.ActivityTooltip = ActivityTooltip
})()
