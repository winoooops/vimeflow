# Kimi usage-gate design → Vimeflow codebase mapping

The handoff + `kimi-cards.jsx` are framed for the design canvas (`--vf-*` tokens, inline
styles, `src/shell.jsx`). This note maps them onto **our** real code for implementation.
Pairs with the backend research in `docs/kimi/kimi-usage-api.md`.

## Tokens / color

| design                                                       | ours                                                                                                                |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `--vf-kimi` `#ffb38a` (peach)                                | `var(--color-agent-kimi-accent)` = **`#fab387`** — use OURS, not the design's approximation                         |
| `--vf-kimi-bright` `#ffcaa8` (gradient end)                  | brighter peach variant; reuse `accentSoft`/`accentDim` or a lighten — confirm against `obsidian-lens.ts` kimi block |
| `rgba(--vf-kimi-rgb,0.16)` chip / `0.14` hover / `0.09` wash | `accentDim` (0.16) / hover / wash tokens already exist for kimi                                                     |
| `--vf-text` / `-1` / `-2` / `-3`                             | `text-on-surface` / `…-variant` / `…-muted` (M3)                                                                    |
| `--vf-surface-0/2-rgb`, `--vf-outline-rgb`                   | `surface` / `surface-container` / `outline-variant`                                                                 |
| `--vf-warn` (ERROR coral)                                    | the warning token (M3)                                                                                              |

## Components

| design piece                                 | our target                                                                                                                                                                                                                                               |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UsageBar` / `KimiUsageBar`                  | **`RateLimitBar.tsx`** — it already is label-row + % + track. Add (a) the **reset subline** and (b) a peach fill. **The reset subline is a SHARED enhancement** — Claude/Codex already carry `resetsAt` (`types/index.ts:149`); don't make it kimi-only. |
| `SlotOff/Loading/On/Error` + `RevokeControl` | new kimi-only subtree rendered by **`BudgetMetrics.tsx`** (or a new `KimiUsageGate.tsx`) inside **`StatusCard.tsx`/`AgentStatusPanel`**, gated on `agentType === 'kimi'`                                                                                 |
| `usageGate: 'off'                            | 'loading'                                                                                                                                                                                                                                                | 'on' | 'error'` | new per-session/agent state in the agent-status hook (`useAgentStatus`) or session model; default `'off'`. enable → fires the backend `/usages` fetch (the consent gate); disable → stops it |

## House rules (override the reference JSX)

- **No inline styles** — the design uses them as spec _values_; port to **Tailwind utilities** on M3 tokens. Pin exact design px with arbitrary values (`h-[84px]`) — note the **14px rem root** (`rem` renders at 87.5%, so use px arbitrary values + verify with `getComputedStyle`, not jsdom).
- Repo style: arrow components, explicit return types on exports, no semicolons, single quotes, es5 commas, one-line comments, no task/PR refs, `test()` not `it()`.
- **Icons** (`cloud`, `lock`, `progress_activity`, `schedule`, `cloud_off`, `refresh`, `power_settings_new`, `forum`): Material Symbols — **render in a browser before trusting green tests** (invalid names render as raw ligature TEXT that vitest/textContent can't catch).
- `SLOT_H = 84` fixed across all five states so the session list never jumps — keep this invariant.

## Backend tie-in

The gate's `enable`/`disable` drives the **consent flag** that gates the backend usage poller
(`docs/kimi/kimi-usage-api.md`): only when ON does the adapter `GET /coding/v1/usages` and fill
`StatusSnapshot.rate_limits` (today hardcoded to 0 at `kimi/parser.rs:201`). Drop the response's
`userId`/`region`/`membership` PII — keep only the limit numbers + `resetTime`.
