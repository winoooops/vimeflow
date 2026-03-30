#!/usr/bin/env bash
# Detect active Chrome DevTools Protocol port.
# Chrome only — port 9222.

if curl -s --max-time 2 "http://127.0.0.1:9222/json/version" >/dev/null 2>&1; then
    echo "9222"
    exit 0
fi

echo "No CDP port found on 9222. Is Chrome running with --remote-debugging-port=9222?" >&2
exit 1
