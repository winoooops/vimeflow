# In-App Notifications — Design

**Status:** Draft; approved section-by-section on the feature branch.

**Linear:** [VIM-279](https://linear.app/vimeflow/issue/VIM-279) · [VIM-411](https://linear.app/vimeflow/issue/VIM-411)

**Frontend contract:** `/Users/winoooops/Downloads/notification-center-handoff/NOTIFICATION-CENTER-HANDOFF.md` and the accepted model C in `Notification Island Prototype.html`.

**Delivery branch:** `feature/vim-411-in-app-notifications`; merge to `main` only after the complete feature passes the acceptance gate.

## 1. Architecture and data flow

The feature keeps detection provider-specific but unifies everything immediately after event creation:

```text
Agent lifecycle/attention events ───────────┐
xterm onBell + OSC 9/777 ──────────────────┼─> NotificationInput
libghostty live PTY output → shared scanner ──────────┘
                                                      ▼
                                           useNotificationCenter
                                                      │
                       ┌──────────────────────────────┼──────────────┐
                       ▼                              ▼              ▼
                Session Island                Overlay panel    Sidebar flag
              pill/badge/toast              local or native
```

`NotificationInput` carries `sessionId`, `ptyId`, one of five semantic reasons, title, optional body, occurrence time, and optional producer dedupe key. The accepted UI category is derived rather than supplied: `agent-error` becomes `err`; every other reason becomes `need`. This keeps all producers on one contract and prevents provider-specific category choices.

Producer boundaries are concrete rather than inferred from terminal text:

- Each adapter selects exactly one live upstream completion record and converts it to the existing `AgentLifecycleEvent` `running → idle` edge. That edge may produce background-work completion only when `WorkspaceView` confirms that the target pane is not active. The same completion record never also emits `AgentAttentionEvent`.
- Approval, question, and agent-error notifications require a provider-produced `AgentAttentionEvent`; the coarse lifecycle payload is not used to guess them. The event identifies the PTY, and `WorkspaceView` resolves its owning renderer session. Active authentication input maps to `question-requested`; a fatal authentication failure maps to `agent-error`.
- An unexpected/non-success PTY or agent exit may produce `agent-error`, with crash details retained in the body or source metadata. Ordinary successful shell exit does not notify.
- Parsed BEL/OSC from xterm and Ghostty's live PTY path produce terminal inputs at their terminal-provider edge and never mutate `AgentPhase`.

`useNotificationCenter` owns the in-memory reducer, 50-item cap, read state, deduplication, coalescing metadata, and actions. `WorkspaceView` owns one hook instance and passes a stable publish callback through the same explicit pane plumbing used for cwd events. This avoids a new global state dependency.

The normal renderer owns the Session Island's pill, badge, and toast stages. The panel uses one shared presentation model:

- Local rendering for xterm/Linux.
- A serialized `notification-center` payload rendered by the existing native-overlay host over Ghostty.
- Overlay actions return stable notification IDs; the owning renderer performs read, clear, jump, and approve/open behavior.

System notifications later subscribe after this same reducer boundary; they do not create another event pipeline.

## 2. Event and reducer contract

### Reasons

The renderer accepts only this vocabulary:

```ts
export type NotificationReason =
  | 'turn-complete'
  | 'approval-requested'
  | 'question-requested'
  | 'agent-error'
  | 'terminal-attention'

export type NotificationInput = {
  sessionId: string
  ptyId: string
  reason: NotificationReason
  title: string
  body?: string
  occurredAt: number
  dedupeKey?: string
}

export const notificationCategory = (
  reason: NotificationReason
): 'need' | 'err' => (reason === 'agent-error' ? 'err' : 'need')
```

Each reason answers one routing question:

| Reason               | Meaning                                                                               | Why it is distinct                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `turn-complete`      | A live agent turn finished successfully while its target was in the background.       | Completion needs attention, but has no pending response and must never display Approve.                                                |
| `approval-requested` | The agent is blocked on an explicit permission or tool-execution decision.            | It may eventually support an inline response, but only when the producer supplies a real responder capability.                         |
| `question-requested` | The agent is blocked on user input, including an active login or elicitation flow.    | Opening the correct terminal is always valid; answering inline is provider-specific and is not part of the MVP.                        |
| `agent-error`        | The turn, agent, or PTY ended abnormally and needs inspection.                        | It is the only `err` category. Process crashes and fatal authentication failures are details of this reason, not extra routing states. |
| `terminal-attention` | The terminal emitted a generic attention signal whose semantic intent is unavailable. | It is the lossless fallback for BEL/OSC signals and avoids guessing meaning from human-facing text.                                    |

`login-wall` and `process-crash` are deliberately not reasons: both describe causes, not different notification behavior. `Approve` is an action capability, not a reason. These omissions keep the reducer independent of each agent's internal taxonomy.

### Shared backend event

There is no inheritance hierarchy spanning Rust, TypeScript, xterm, and AppKit. Provider adapters emit the existing lifecycle event for coarse phase changes and one serializable `AgentAttentionEvent` for semantic attention:

```text
AgentAttentionEvent {
  pty_id, reason, title, body?, occurred_at, dedupe_key?
}
```

The reason is limited to `approval-requested`, `question-requested`, and `agent-error`. Completion remains on the existing lifecycle event; `terminal-attention` is created only at the xterm or Ghostty boundary. Backend adapters cannot know the renderer's workspace-session ID, so `WorkspaceView` matches `pty_id` against current pane state while constructing `NotificationInput` and discards an event with no live match. After that mapping, all producers use the same reducer.

### Provider mappings

Mappings use machine-readable events that the installed agent versions actually expose. Display strings and terminal transcript text are never parsed to recover intent.

| Agent                                   | Exact upstream event                                                                        | Vimeflow reason                                             | Minimum integration path                                                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code, current transcript adapter | assistant `message.stop_reason` of `end_turn`, `stop_sequence`, or `max_tokens`             | `turn-complete`                                             | Reuse the adapter's existing sole lifecycle completion edge; do not also add the `Stop` hook as a completion producer.                                        |
| Claude Code                             | `PermissionRequest`                                                                         | `approval-requested`                                        | Same hook sink; retain the hook event name as the discriminator.                                                                                              |
| Claude Code                             | `PreToolUse` for `AskUserQuestion`                                                          | `question-requested`                                        | Same sink. Do not infer login state from prompt text. `Elicitation` remains a later compatibility addition rather than a second MVP path.                     |
| Claude Code                             | `StopFailure`                                                                               | `agent-error`                                               | Same sink; error details become bounded body text.                                                                                                            |
| Codex CLI, current rollout adapter      | `task_complete`                                                                             | `turn-complete`                                             | Reuse the current rollout JSONL parser as the sole completion producer.                                                                                       |
| Codex CLI, current rollout adapter      | `exec_approval_request`; `apply_patch_approval_request`; event-message `request_user_input` | `approval-requested`                                        | Extend the installed rollout parser and keep stable request/approval IDs as dedupe keys.                                                                      |
| Codex CLI, current rollout adapter      | response-item `function_call` named `request_user_input`; `elicitation_request`             | `question-requested`                                        | Extend the same parser. No app-server client or display-text inference is needed.                                                                             |
| Kimi Code, current wire adapter         | `context.append_loop_event` with `step.end.finish_reason = end_turn`                        | `turn-complete`                                             | Preserve the existing lifecycle completion edge. Installed 0.31 transcripts do not contain `turn.ended` or `interaction.request`.                             |
| Kimi Code, current hook surface         | `PermissionRequest`; `StopFailure`                                                          | `approval-requested`; `agent-error`                         | Exact events exist, but Kimi exposes only global hook configuration and no safe per-session overlay. MVP does not mutate or mirror user-global configuration. |
| OpenCode                                | `session.status` transition from `busy` or `retry` to `idle`                                | `turn-complete`                                             | Extend the existing Vimeflow plugin/DTO as the sole lifecycle completion producer and suppress completion if the same turn already emitted `session.error`.   |
| OpenCode                                | `permission.asked`; `question.asked`; `session.error`                                       | `approval-requested` / `question-requested` / `agent-error` | Add these exact event names to the existing bridge whitelist and DTO. Reply/reject events clear pending response capability but do not mark read.             |

Kimi 0.31 has no dedicated question hook and no safe per-session hook-injection option. Its MVP therefore provides exact completion only; approval, question, and error notifications stay deferred rather than being guessed from display text. The same rule applies across providers—coarse blocked or idle phases never guess approval versus question.

Claude Code's upstream `Stop` hook is an exact completion signal, but Vimeflow already derives that edge from the live transcript. It is documented as an available alternative, not installed in the MVP, because enabling both would recreate the duplicate-producer bug.

Generic BEL/OSC input remains a terminal fallback because the terminal protocol does not identify which process emitted it. Exact provider events carry stable dedupe keys; no adapter turns terminal display text into a semantic reason.

### Terminal mappings

- xterm routes `onBell` and recognized OSC 9/777 sequences to `terminal-attention` through its existing terminal callbacks.
- Native Ghostty reuses the existing live raw-PTY output path and sends BEL/OSC 9/777 through the same bounded scanner before forwarding output to the parented `NSView`. The existing cursor/replay gate prevents hydration notifications, so no new C ABI or delegate path is needed.
- OSC 7 remains current-working-directory transport and never creates a notification.
- Terminal payloads are untrusted: strip control characters, apply a fixed display-length bound, and discard malformed sequences before publishing.

### Reducer and eligibility rules

- The notification center creates a record only for a live event whose target session/pane is not currently active. Foreground events still update agent phase/status but are already visible and do not enter the center.
- Initial hydration, transcript replay, adapter reconnect replay, duplicate idle, and user-cancelled turns do not notify.
- Prefer a stable provider event or turn ID as `dedupeKey`. Producer selection prevents cross-source duplicates before the reducer; the key handles replay or duplicate delivery from the selected source. Without one, one parsed terminal sequence creates one input, and the reducer does not invent semantic identity.
- Records are newest-first and capped at 50 in memory. Evict the oldest records after insertion.
- A record becomes read only through an explicit row click, Open, a capability-backed Approve action, or Mark all. Resolution events from an agent do not silently mark it read.
- Open is derived from `sessionId` and `ptyId`. Approve is hidden unless the originating adapter can resolve a live responder reference safely; the MVP adds no speculative responder abstraction.
- Toast presentation follows the accepted handoff: four seconds, with simultaneous arrivals coalesced visually. Toast dismissal does not mark the underlying record read.

### Source references

- Claude Code hook contracts: <https://code.claude.com/docs/en/hooks>
- Codex CLI rollout fixtures and DTOs: `~/.codex/sessions/` and `crates/backend/src/agent/adapter/codex/transcript_dto.rs`
- Installed Kimi 0.31 transcript and hook contracts: the local `kimi` binary plus `crates/backend/src/agent/adapter/kimi/transcript_dto.rs`
- OpenCode notification behavior: <https://github.com/anomalyco/opencode/blob/v1.18.8/packages/tui/src/feature-plugins/system/notifications.ts>
- Installed libghostty path and Vimeflow's raw PTY forwarding contract: `src/features/terminal/components/TerminalPane/GhosttyBody.tsx`
- Existing integration boundaries: `crates/backend/src/terminal/bridge.rs`, `crates/backend/src/agent/adapter/codex/transcript_dto.rs`, `crates/backend/src/agent/adapter/kimi/transcript_dto.rs`, `crates/backend/src/agent/adapter/opencode/plugin/vimeflow-opencode-bridge.ts`, and `crates/backend/src/agent/adapter/opencode/transcript_dto.rs`.

## 3. In-app presentation and native overlay

### Ownership

`WorkspaceView` owns one notification-center hook. It supplies the current session/pane lookup, publishes normalized inputs, prunes records when a session is explicitly closed, and derives sidebar flags. The existing `SessionIsland` owns the visible four-stage interaction and keeps `SessionIslandIndicator` unchanged.

The minimum frontend split is:

- `useNotificationCenter` — records, reducer actions including `dismiss(id)`, unread/category selectors, and the 50-item cap.
- `NotificationIsland` — bell, toast, panel, timers, coalescing, outside dismissal, and accessibility behavior.
- A serializable `notification-center` native-overlay payload and renderer for the panel only.

No app-wide store, event bus, persistence layer, or generic notification framework is added. If system notifications later need another renderer, they subscribe to the normalized publish boundary rather than changing this local ownership.

### Record and derived presentation

The reducer turns each accepted `NotificationInput` into an immutable record with a generated ID and `read: false`. It stores notification facts only. Agent glyph, accent, and session display name are resolved from the current session and shared agent registry when rendering, so a row cannot claim an agent different from its target session.

```text
NotificationRecord = NotificationInput + { id, read }
```

The UI derives rather than stores:

- `kind` from `notificationCategory(reason)`.
- unread count and whether any unread `err` exists.
- `Needs you` and `Alerts` groups.
- the sidebar's per-session highest unread category.
- Open capability from whether the target pane still exists.

Explicit session close removes that session's records. Agent/PTY failure does not remove them; the errored session remains available for inspection.

### Four-stage state machine

| Stage   | Entry                                                                                   | Exit                                                                                                                                            |
| ------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `pill`  | No records exist.                                                                       | First accepted arrival enters `toast`.                                                                                                          |
| `badge` | Records exist and neither transient surface is open.                                    | Arrival enters `toast`; bell click enters `panel`; Clear all enters `pill`.                                                                     |
| `toast` | Any accepted arrival. The newest item replaces prior toast content and increments `+N`. | Four-second dwell, close button, outside pointerdown, or Escape returns to `badge`; body click opens `panel`; Open acts and returns to `badge`. |
| `panel` | Bell or toast-body activation.                                                          | Bell toggle, outside pointerdown, or Escape returns to `badge`; Clear all enters `pill`.                                                        |

The dwell uses one timeout. Pointer entry cancels it; pointer leave starts a fresh four seconds. A new arrival replaces the displayed item, increments the coalesced count, and starts a fresh dwell. Coalescing never changes reducer records and never creates a queue.

Read behavior remains reducer-driven and matches the handoff exactly: only row selection, Open, a real capability-backed Approve, or Mark all changes read state. Opening or dismissing either surface does not. Since the MVP has no responder integration, Approve is absent rather than rendered as a non-working affordance.

The row `×` dispatches `dismiss(id)`, removing only that record without changing any other record's read state. Dismissing the final record returns the island to `pill`; Clear all remains the bulk equivalent.

### Session Island rendering

- With the feature flag off, `SessionIsland` receives no notification props and renders the current indicator-only DOM and geometry.
- `pill` reserves no bell space. Once records exist, `badge` renders the existing top-workspace notification slot as a real `IconButton`/button with `aria-haspopup="dialog"`, `aria-expanded`, and `aria-label="Notifications, N unread"`.
- `toast` stays inside the 44px top chrome. It compresses the indicator strip and uses the accepted 380px one-line layout; it is not a separate application toast.
- The local xterm panel is a 440px dialog surface anchored below the island. It groups Needs you before Alerts, limits the scrolling list to 262px, and exposes Mark all read and Clear all.
- Row, Open, per-row dismiss, toast close, footer, and bell controls use existing button primitives. Hover labels use the shared `Tooltip`; no native `title`, raw icon button, or feature-level `@floating-ui/react` import is introduced.
- Motion values come directly from the accepted handoff. `prefers-reduced-motion` reduces transitions to 1ms and disables the bell ping and row-entry animation.

Pointer-only means no global notification shortcut in this iteration, not inaccessible controls. Bell, rows, and actions remain keyboard-operable; the panel has dialog semantics, Escape dismissal, focus containment, and focus return to the bell.

### Ghostty overlay

The pill, badge, and toast fit within the renderer-owned top chrome and remain local. Only the downward-opening panel overlaps the parented Ghostty `NSView`, so only that panel uses the existing native-overlay transport.

The main renderer serializes the current grouped presentation into a bounded `notification-center` dialog payload, anchors it with the island's DOM rect, and registers action handlers by stable notification ID. The existing overlay window performs the CSS-pixel-to-window-point placement and theme snapshot transfer; no second AppKit panel system is introduced. The host renders the same notification panel component and returns action IDs for row/Open/dismiss/Mark all/Clear all. The owning renderer mutates state and changes sessions.

The native-overlay validator enforces maximum item count and bounded strings at the IPC boundary. The notification dialog joins the existing focus-owned dialog allowlist so keyboard navigation, Escape, and focus restoration work over Ghostty. If native overlay opening is rejected, the local panel remains available in xterm/dev; a Ghostty production build reports the rejected surface rather than placing an unusable DOM panel behind the native view.

### UI verification

- Reducer tests cover insertion, dedupe, 50-item eviction, read semantics, single-record dismiss, clear/prune, and derived alert priority.
- Island tests use fake timers for all four stages, hover pause/restart, coalescing, outside dismissal, and reduced motion.
- Accessibility tests cover button names, dialog state, focus return, and no read-on-open/dismiss.
- Native-overlay contract tests cover payload validation, bounds, row/dismiss action routing, focus ownership, and fallback rejection.
- Workspace tests prove flag-off chrome remains unchanged, the existing 700px compact geometry still clears macOS controls, Open selects the matched session/pane, and sidebar flags reflect the highest unread category.
- Final visual verification compares Catppuccin and Flexoki at normal and reduced motion against the accepted model C handoff, in both xterm and packaged native Ghostty paths.

## 4. Delivery plan and branch gates

All implementation stays on `feature/vim-411-in-app-notifications`. Each slice starts with its smallest failing contract test, ends with targeted checks, and receives a GPT-5.6 Sol subagent review. Findings rated HIGH or MEDIUM and above the review confidence threshold are applied before the slice advances. Commits use the repository's required Codex trailer. Nothing merges to `main` until the final gate passes.

### Slice 1 — notification domain and local Session Island

1. Add the five-reason TypeScript contract, category derivation, reducer/hook, and co-located tests.
2. Replace the quiet `showNotifications` placeholder with `NotificationIsland`, preserving flag-off DOM and `SessionIslandIndicator` behavior.
3. Implement pill/badge/toast/local-panel stages, read/dismiss/clear actions, sidebar derivation, accessibility, and reduced motion from the accepted handoff.
4. Feed deterministic inputs directly in tests; do not ship a mock event bus or debug producer.

Gate: reducer and Session Island suites pass; the flag-off top-chrome tests are unchanged; Catppuccin/Flexoki local xterm visuals match model C.

### Slice 2 — Ghostty-safe panel

1. Add the bounded serializable `notification-center` payload to the existing native-overlay union and Electron validator.
2. Reuse the panel presentation component in `NativeOverlayHost`; add row/Open/dismiss/Mark all/Clear all action routing by stable ID.
3. Add `notification-center` to focus ownership and verify anchor conversion from the island DOM rect to the transparent overlay window.
4. Verify outside close, Escape, focus return, theme transfer, and rejected-open behavior over a parented Ghostty view.

Gate: native-overlay unit tests and the targeted Ghostty layering E2E pass; the panel is clickable above the `NSView` and does not move the 44px top chrome.

### Slice 3 — semantic agent producers

1. Add the Rust `AgentAttentionReason`/`AgentAttentionEvent` contract with PTY-only identity, emit helper, generated TypeScript binding, and live-versus-replay tests.
2. Claude Code: keep the current transcript-derived lifecycle completion as the sole completion source. Extend the existing per-session settings overlay with bounded hook JSONL only for `PermissionRequest`, `PreToolUse` matched to `AskUserQuestion`, and `StopFailure`; reuse the current watcher lifecycle rather than creating a second watcher framework.
3. Codex: keep current rollout `task_complete` as the sole completion source and extend that parser for its exact approval, `request_user_input`, and elicitation records. Do not parse OSC text and do not add app-server solely for notifications.
4. Kimi: preserve the installed wire adapter's `step.end/end_turn` completion edge. Document the missing safe per-session hook injection and do not mutate global Kimi configuration or invent transcript event types.
5. OpenCode: extend the installed bridge whitelist and DTO for permission/question events, retain `session.status` as sole completion source, and suppress completion after same-turn error.
6. Wire live backend attention and lifecycle events through `WorkspaceView`'s PTY-to-session lookup into the one reducer; discard replay, foreground, unmatched, and duplicate events.

Gate: Rust adapter fixtures cover every mapped upstream event, replay emits no notification, generated bindings are clean, and an actual background turn for each installed agent produces no more than one record.

### Slice 4 — xterm and libghostty terminal producers

1. xterm: connect `onBell` plus OSC 9/777 parser handlers to a bounded `terminal-attention` input; leave OSC 7 cwd handling untouched.
2. libghostty: reuse `GhosttyBody`'s existing live raw-PTY forwarding path and cursor/replay gate with the same stateful BEL/OSC scanner; add no native ABI solely for notifications.
3. Apply the same control-character stripping, string bounds, and active-target eligibility on both terminal paths.
4. Cover split and malformed payloads, replay suppression, and OSC 7 isolation.

Gate: identical fixtures produce equivalent normalized inputs in xterm and Ghostty; OSC 7 changes cwd only; replay emits nothing.

### Slice 5 — integration, release, and merge

1. Exercise completion, approval, question, error, terminal fallback, coalescing, read semantics, session jump, sidebar flags, and explicit session close end to end.
2. Run `cargo test --manifest-path crates/backend/Cargo.toml`, `npm run test:coverage`, `npm run lint`, `npm run type-check`, and `npm run build`, followed by targeted xterm/agent and packaged macOS arm64 Ghostty E2E checks. The configured 80% coverage thresholds must pass before PR/merge.
3. Perform visual/accessibility QA against the handoff at normal and compact widths, both baseline themes, and reduced motion. Record native geometry evidence required by the Ghostty debugging contract.
4. Remove test-only inputs and the temporary production feature flag after all real producers pass, update `docs/roadmap/progress.yaml`, and place final decisions/test evidence on VIM-411 under the VIM-279 epic.
5. Open the PR from the feature branch, resolve review findings, require green CI and the complete acceptance checklist, then merge to `main`. System notifications remain in VIM-412 and consume this boundary later.

### Linear breakdown

VIM-411 remains the MVP parent beneath VIM-279. Once this design is approved, create four implementation children under VIM-411: Session Island + reducer, native Ghostty overlay, semantic agent producers, and terminal producers + release verification. The children link back to this spec and close only when their slice gate is met; VIM-411 closes only after the feature-branch PR merges.
