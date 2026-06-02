# QA Runner Local Cloudflare Host

This note tracks the Phase 0 host proof for VIM-18. The goal is to prove the
daemon as a production-shaped service on the existing development machine before
moving the same control-plane role to AWS.

## Host

- Hostname: `qa-runner.winoooops.com`
- Tunnel: Cloudflare Tunnel `qa-runner`
- Origin service: `http://127.0.0.1:8787`
- Daemon mode: `QA_APPROVE=0`
- Concurrency: `QA_MAX_PARALLEL=1`

## Security

- GitHub webhook ingress uses HMAC-SHA256 over the raw request body.
- `/status` is protected by `QA_STATUS_TOKEN`.
- Cloudflare Access is not enabled for `/webhooks/github` because GitHub cannot
  complete an interactive login flow.

## Proof Sequence

1. Start `cloudflared` as a systemd service.
2. Start the QA daemon on `127.0.0.1:8787`.
3. Verify public `/status` auth behavior through the tunnel.
4. Verify unsigned webhook requests fail closed.
5. Register the GitHub repository webhook.
6. Trigger a real PR event and confirm the daemon queue processes it.
