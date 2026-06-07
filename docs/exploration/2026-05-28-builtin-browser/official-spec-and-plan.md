# Built-in browser pane official spec and planner

Status: draft v0
Date: 2026-05-29
Owner: Vimeflow

## Product decision

Ship a Vimeflow-owned browser pane based on Electron `WebContentsView`, persistent app-scoped partitions, built-in pane tabs, and a pane-scoped CDP-compatible automation proxy.

The browser is not a throwaway automation surface. It is a durable workspace browser for GitHub, SaaS dashboards, documentation, YouTube/tutorial playback, music, and agent-observable web state.

## Confirmed spike results

- Multi-tab behavior works in the docked browser pane.
- Persistent cache/session reuse works.
- Video playback works with audio.
- Passkey parity is deferred.

## Non-goals for this phase

- No system Chrome profile import.
- No Google account sync.
- No Chrome extension support.
- No plugin runtime implementation.
- No Widevine claim on stock Electron unless a CDM-capable distribution is selected.
- No passkey requirement for launch; users may use non-passkey sign-in fallback flows.

## Required architecture

- Host browser content in Electron main with `WebContentsView`.
- Render only Vimeflow browser chrome in React.
- Use one persistent partition per Vimeflow workspace/session: `persist:vimeflow-browser:<workspaceId>:<sessionId>`.
- Persist cookies, HTTP cache, IndexedDB, localStorage, service worker state, and site sessions inside that partition.
- Convert page popup/new-window requests into Vimeflow-owned browser tabs inside the pane.
- Keep all tabs in a browser pane on the same persistent partition.
- Expose only registered browser-pane targets through the Vimeflow CDP-compatible proxy.
- Keep raw Electron remote debugging dev-only.

## Browser pane tab model

Each browser pane owns a list of native tabs.

```ts
interface BrowserPaneTab {
  id: string
  url: string
  title: string | null
  active: boolean
}
```

The active native tab is the visible `WebContentsView` and the CDP target for the pane. Inactive tabs keep their `webContents` alive but are moved to zero bounds.

## Required browser operations

- `createPane`: create or reconnect a browser pane.
- `setBounds`: position only the active tab view.
- `navigate`: navigate the active tab.
- `newTab`: create a first-class Vimeflow browser tab.
- `activateTab`: switch the active native tab.
- `closeTab`: close a native tab without closing the pane unless it is the final tab.
- `destroyPane`: close all tabs owned by the pane.
- `getCdpInfo`: return pane-scoped CDP URL/token/origin information.

## Auth and cache policy

- Cache is enabled and persistent by default.
- Cookies and site storage are scoped to Vimeflow partitions, not system Chrome.
- OAuth popup flows must become in-pane tabs.
- Google/GitHub/SaaS login pages should be reusable after the user signs in once.
- Passkeys are deferred. Electron WebAuthn can be revisited as a distribution/platform feature, but it is not required for this browser pane milestone.

## Automation boundary

The CDP-compatible proxy lists only registered browser panes and forwards a restricted command set to the active tab. External clients do not see the trusted Vimeflow shell `webContents`.

Initial allowed domains:

- `Accessibility`
- `DOM`
- `Emulation`
- `Input`
- `Log`
- `Network`
- `Page`
- `Runtime`

## Planner

### Phase 1: stabilize the spike

- Keep the current WebContentsView host.
- Keep the Shell/Browser picker in empty SplitView slots.
- Keep persistent partitions with cache enabled.
- Keep first-class browser tabs for popup/new-window flows.
- Keep non-passkey auth fallback as accepted scope.
- Run focused browser/electron tests, lint, type-check, and final Codex review.

### Phase 2: productize browser chrome

- Add explicit tab titles, favicon handling, loading state, and stop/reload controls.
- Add back/forward controls.
- Add clear-site-data controls at the Vimeflow partition level.
- Add attachment status for active CDP clients.
- Add user-facing permission prompts for camera, microphone, geolocation, and notifications before enabling those permissions.

### Phase 3: persistence and recovery

- Persist browser pane tab metadata across renderer refresh and app restart.
- Reconnect React chrome to existing native views after renderer reload.
- Preserve active tab selection.
- Add crash recovery UI for a failed native tab.

### Phase 4: automation API design

- Finalize the agent-plugin tool registration contract.
- Add pane-level grant UI for automation.
- Define token lifetime, origin allowlist, and revocation behavior.
- Keep plugin runtime implementation out of scope until the API review is complete.

### Phase 5: distribution-dependent media/auth decisions

- Decide whether to ship a CDM-capable Electron distribution for Widevine.
- Decide whether to invest in signed/platform WebAuthn support.
- If passkeys are required later, define platform matrix and entitlement/signing requirements before implementation.

## Launch acceptance

- `+ add pane -> Browser` creates a docked browser pane.
- New-window/OAuth flows open as in-pane tabs.
- Browser cache and login state survive renderer refresh and app restart.
- YouTube or equivalent non-DRM video playback works with audio.
- CDP proxy can list the pane target and run navigate/evaluate against the active tab.
- `npm run lint`, `npm run type-check`, and `npm run test` pass.
- Final Codex review against `main` returns zero structural findings.
