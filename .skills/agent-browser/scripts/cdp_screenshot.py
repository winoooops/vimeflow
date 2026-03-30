#!/usr/bin/env python3
"""Capture a screenshot from a Chrome DevTools Protocol tab via WebSocket.

Usage:
    python3 cdp_screenshot.py <port> <tab_id> [output_path]

    port        - CDP port (e.g., 9222)
    tab_id      - Tab ID from /json/list
    output_path - Optional. Defaults to ./screenshot.png

Supports full-page capture with --full flag:
    python3 cdp_screenshot.py <port> <tab_id> [output_path] --full
"""

import asyncio
import base64
import json
import sys

import websockets


async def capture_screenshot(port: str, tab_id: str, output: str, full_page: bool) -> None:
    ws_url = f"ws://127.0.0.1:{port}/devtools/page/{tab_id}"

    async with websockets.connect(ws_url, max_size=50 * 1024 * 1024) as ws:
        params = {"format": "png"}
        if full_page:
            params["captureBeyondViewport"] = True

        await ws.send(json.dumps({
            "id": 1,
            "method": "Page.captureScreenshot",
            "params": params,
        }))

        while True:
            resp = await asyncio.wait_for(ws.recv(), timeout=15)
            data = json.loads(resp)
            if data.get("id") == 1:
                if "error" in data:
                    print(f"CDP error: {data['error']['message']}", file=sys.stderr)
                    sys.exit(1)
                img_data = base64.b64decode(data["result"]["data"])
                with open(output, "wb") as f:
                    f.write(img_data)
                print(f"Screenshot saved: {output} ({len(img_data)} bytes)")
                break


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flags = [a for a in sys.argv[1:] if a.startswith("--")]

    if len(args) < 2:
        print(f"Usage: {sys.argv[0]} <port> <tab_id> [output_path] [--full]", file=sys.stderr)
        sys.exit(1)

    port = args[0]
    tab_id = args[1]
    output = args[2] if len(args) > 2 else "screenshot.png"
    full_page = "--full" in flags

    asyncio.run(capture_screenshot(port, tab_id, output, full_page))
