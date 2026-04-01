---
name: agent-browser
description: Browser automation via Chrome DevTools Protocol (CDP). Fetch page content, capture screenshots, extract data, check tabs, navigate, and interact with web applications. Use when user says "check browser", "open URL", "browser tabs", "scrape page", "screenshot", "CDP", "web automation", or needs to verify website state, visually compare UI against design specs, extract data from pages, or monitor web dashboards.
version: 1.1.0
author: winoooops
tags:
  - browser
  - cdp
  - automation
  - web-scraping
  - screenshot
  - visual-verification
---

# Agent Browser

Control Chrome via CDP for web automation and data extraction.

## Prerequisites

Chrome must be running with remote debugging on **port 9222**:

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --no-first-run --no-default-browser-check --remote-allow-origins=* --user-data-dir="C:\tmp\chrome-cdp"
```

**MANDATORY:** `--user-data-dir` is required. Without it, CDP will NOT start — Chrome silently drops `--remote-debugging-port` when it attaches to an already-running instance via the default profile's single-instance lock. A separate data dir forces a new instance.

**WSL2 + mirrored networking:** `127.0.0.1:9222` reaches Windows directly. No portproxy needed. If `firewall=true` in `.wslconfig`, add a Windows Firewall rule for TCP 9222.

**Verify:**

```bash
curl -s http://127.0.0.1:9222/json/version
```

## Commands

### List Tabs

```bash
curl -s http://127.0.0.1:9222/json/list
```

### Open URL

```bash
curl -s "http://127.0.0.1:9222/json/new?url=https://example.com"
```

### Close Tab

```bash
curl -s "http://127.0.0.1:9222/json/close/<tab_id>"
```

### Get Page Content

```bash
python3 <skill_dir>/scripts/cdp_get_page_text.py 9222 <tab_id>
```

### Screenshot (Viewport)

```bash
python3 <skill_dir>/scripts/cdp_screenshot.py 9222 <tab_id> screenshot.png
```

### Screenshot (Full Page)

```bash
python3 <skill_dir>/scripts/cdp_screenshot.py 9222 <tab_id> full.png --full
```

### Detect CDP Port

```bash
bash <skill_dir>/scripts/cdp_detect_port.sh
```

## CDP Endpoints

- `/json/list` — list all tabs
- `/json/version` — browser version info
- `/json/new?url=<url>` — open new tab
- `/json/close/<tab_id>` — close tab

## Response Shape

```json
[
  {
    "id": "ABCD1234",
    "title": "Page Title",
    "url": "https://example.com",
    "webSocketDebuggerUrl": "ws://127.0.0.1:9222/devtools/page/ABCD1234"
  }
]
```

## Troubleshooting

- **CDP not starting:** Kill ALL Chrome processes first, then relaunch with `--user-data-dir`
- **Empty reply from server:** Check for portproxy conflicts or firewall blocking
- **Fresh profile has no cookies:** Log into sites manually in the CDP Chrome instance
- **WSL can't reach port:** Verify `networkingMode=mirrored` in `.wslconfig`, check `firewall` setting
- **Ref:** <https://github.com/openclaw/openclaw/blob/main/docs/tools/browser-wsl2-windows-remote-cdp-troubleshooting.md>

## Visual Verification Workflow

Use screenshots to verify frontend implementation against design specs. This is the recommended flow for UI development:

1. **Build** the component following `DESIGN.md` and `docs/design/` specs
2. **Serve** the dev server (`npm run dev` or open the HTML file)
3. **Open** the page in CDP Chrome: `curl -s "http://127.0.0.1:9222/json/new?url=http://localhost:5173"`
4. **Screenshot** the result: `python3 <skill_dir>/scripts/cdp_screenshot.py 9222 <tab_id> current.png`
5. **Compare** the screenshot against the reference in `docs/design/<screen>/screen.png` using the Read tool (both are images)
6. **Iterate** — fix mismatches and re-screenshot until the implementation matches the spec

This closes the loop between design specs and actual implementation without requiring manual visual checks.
