# Kimi usage API — exploration (VIM-122)

Goal: fill the agent-status card's **5h / weekly usage** (`rate_limits`) for kimi,
alongside the Claude Code and Codex CLI adapters. Kimi writes **no** usage data to
its on-disk session state, so — unlike Claude Code and Codex CLI, which read it
from their own status/rollout files — kimi needs a **network call**. This
documents the endpoint, auth, and shape found by inspecting the (unstripped)
kimi-code binary and a live probe.

## Endpoint

```
GET ${KIMI_CODE_BASE_URL}/usages          # default base: https://api.kimi.com/coding/v1
```

- Source: `agent-core/src/agent/usage/index.ts` — `kimiCodeUsageUrl()` = `${base}/usages`,
  fetched by `fetchManagedUsage(url, accessToken)`.
- Note the **plural** `/usages` (not `/usage`).

## Auth + headers (both required)

- `Authorization: Bearer <accessToken>` — for an **api-key** user the api_key itself works
  (live response: `"authentication":{"method":"METHOD_API_KEY","scope":"FEATURE_CODING"}`).
  An **OAuth** user would pass their access token from `<kimi_home>/credentials/<profile>.json`.
- `User-Agent: kimi-code/<version>` — **mandatory**: a raw client (no kimi UA) is rejected with
  `access_terminated_error` ("only available for Coding Agents such as Kimi CLI, Claude Code…").
  `createKimiUserAgent` = `"<product>/<version>"`, e.g. `kimi-code/0.14.3`.

Both the api_key and base_url live in `<kimi_home>/config.toml` under
`[providers."managed:kimi-code"]` (`api_key`, `base_url`) — the adapter can read them the same
way the locator resolves the kimi home (env `KIMI_CODE_HOME` → provider home → default).

## Live response shape (2026-06-14)

```json
{
  "user": {
    "userId": "…",
    "region": "REGION_CN",
    "membership": { "level": "LEVEL_INTERMEDIATE" }
  },
  "usage": {
    "limit": "100",
    "used": "40",
    "remaining": "60",
    "resetTime": "2026-06-17T10:00:46Z"
  },
  "limits": [
    {
      "window": { "duration": 300, "timeUnit": "TIME_UNIT_MINUTE" },
      "detail": {
        "limit": "100",
        "used": "17",
        "remaining": "83",
        "resetTime": "2026-06-14T08:00:46Z"
      }
    }
  ],
  "parallel": { "limit": "20", "details": ["…"] },
  "totalQuota": { "limit": "100", "remaining": "99" },
  "authentication": { "method": "METHOD_API_KEY", "scope": "FEATURE_CODING" },
  "subType": "TYPE_PURCHASE"
}
```

- Numbers arrive as **strings** (`"100"`, `"40"`) — parse to numbers.
- `resetTime` is **ISO-8601 UTC** — convert to epoch for `resets_at: u64`.
- Field spelling drifts across versions (`used`/`remaining`, `resetAt`/`reset_at`,
  `resetTime`); kimi's own `parseManagedUsagePayload` is deliberately loose — ours should be too.

## Mapping → `RateLimits`

| card field           | source                                                                                |
| -------------------- | ------------------------------------------------------------------------------------- |
| `seven_day` (weekly) | top-level `usage`: `used_percentage = used/limit*100`, `resets_at = resetTime`        |
| `five_hour`          | `limits[]` whose window = **300 min** (`duration*timeUnit == 5h`): same from `detail` |

(Both are `RateLimitInfo { used_percentage: f64, resets_at: u64 }`.)

## Proposed implementation (PR 2)

1. A small **usage poller** in the kimi adapter: resolve `(base_url, token)` from
   `config.toml` (or OAuth credentials), GET `/usages` with the kimi UA, parse loosely,
   fill `StatusSnapshot.rate_limits` (today hardcoded to zero in `parser.rs:201`).
2. Poll on attach + on a slow cadence (usage windows are 5h/weekly — ~60s is plenty);
   cache the last good value; on network/auth failure keep the last value (or empty) and
   never block the local status path.
3. **New dependency to flag:** this is the first **network** call in the kimi adapter (the
   rest is local-file only). Needs an async HTTP client + timeouts + failure isolation.

## Consent / permission gate (kimi-only)

Because `/usages` is the **first outbound network call** in the kimi adapter (it sends the
kimi api_key to `api.kimi.com`), it must be **opt-in**. Claude/Codex don't need this — they
read local files only.

- **Default OFF.** No `/usages` call until the user explicitly enables it.
- The kimi agent-status card (and only kimi — gated on `agentType === 'kimi'`) renders a
  **permission button** in place of the usage bars while OFF (e.g. "Show plan usage →" + a
  one-line rationale). ON → the 5h / weekly bars render.
- The consent flag is **persisted** (app settings), so it's a one-time action, with a
  **revoke** in Settings.
- The **backend usage poller is gated on the flag** — it only fetches `/usages` when consent
  is ON, so the button starts/stops the actual network calls, not just the UI.

Flow: kimi detected → card shows Enable button (no network) → click → consent persisted →
backend polls `/usages` → emits `rate_limits` → bars render → revoke stops it.

Open design choices (pending Will): consent scope (global vs per-pane), a first-enable
confirmation modal vs inline button, and revoke location (Settings only vs also on the card).

## Resolved in PR 2

- **Poll location:** the existing kimi transcript supervisor (a background thread that already
  re-aggregates status every ~750 ms) drives the fetch + merges `cached_rate_limits()` into its
  emit, so idle / reattached sessions update without a fresh prompt.
- **Token resolution precedence:** config.toml `api_key` first; otherwise the OAuth bearer token
  under `<home>/credentials/<profile>.json` (profile `kimi-code`), read leniently across token
  field names. When the managed section exists but no token resolves, the fetch is skipped with a
  `log::warn` (not silent).
- **Privacy:** only the limit numbers map into `RateLimits`; `userId`/`region`/`membership` are
  dropped at the parse boundary and never logged, and the token is never logged.
