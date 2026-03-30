#!/usr/bin/env python3
"""Fetch page text from a Chrome DevTools Protocol tab via WebSocket."""

import asyncio
import json
import sys
import websockets


async def get_page_text(port, tab_id):
    ws_url = f"ws://127.0.0.1:{port}/devtools/page/{tab_id}"

    async with websockets.connect(ws_url) as ws:
        # Enable Runtime
        await ws.send(json.dumps({"id": 1, "method": "Runtime.enable"}))

        # Drain initial messages
        for _ in range(10):
            try:
                await asyncio.wait_for(ws.recv(), timeout=0.3)
            except Exception:
                break

        # Get page text
        await ws.send(json.dumps({
            "id": 99,
            "method": "Runtime.evaluate",
            "params": {
                "expression": "document.body.innerText.substring(0, 5000)",
                "returnByValue": True
            }
        }))

        while True:
            resp = await asyncio.wait_for(ws.recv(), timeout=5)
            data = json.loads(resp)
            if data.get("id") == 99:
                print(data["result"]["result"]["value"][:3000])
                break


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <port> <tab_id>", file=sys.stderr)
        sys.exit(1)
    asyncio.run(get_page_text(sys.argv[1], sys.argv[2]))
