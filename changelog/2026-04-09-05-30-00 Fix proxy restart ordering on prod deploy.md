# Fix proxy restart ordering on prod deploy

## What changed

Two ordering bugs were fixed in the production blue/green deploy sequence.

### Bug 1: `update-service.sh` ran before `spawnProdViaProxy`

`scripts/update-service.sh` (which restarts `primordia-proxy` when `reverse-proxy.ts` changes) was previously called inside `blueGreenAccept`, **before** `spawnProdViaProxy`. This caused a race condition:

1. `update-service.sh` detects the proxy script changed → `systemctl restart primordia-proxy`
2. The proxy restarts (briefly down / freshly up with no prod server registered)
3. `spawnProdViaProxy` tries to `POST /_proxy/prod/spawn` to the proxy → **fails** ("Unable to connect" or connection refused)
4. The branch is already written to git config as accepted, but the new prod server was never spawned

The symptom from the deploy log:

```
✅ Accepted — deployed to production
⚠️ Could not reach proxy for prod spawn: Unable to connect. Is the computer able to access the url?
```

**Fix:** Moved `update-service.sh` to run **after** `spawnProdViaProxy` in both deploy paths (`runAcceptAsync` and `retryAcceptAfterFix`). The `blueGreenAccept` helper no longer runs `update-service.sh` at all.

### Bug 2: proxy killed the old server before `update-service.sh` could run

After the first fix, a subtler race remained: in `handleProdSpawn`, the proxy sent `SIGTERM` to the old production server **before** sending `done: true` back over the SSE stream. The old production server is the one running the deploy — it calls `spawnProdViaProxy`, waits for `done: true`, then runs `update-service.sh`. But since the proxy had already killed it (or was in the process of doing so), `update-service.sh` often never ran.

**Fix:**
- `handleProdSpawn` in `scripts/reverse-proxy.ts` no longer kills the old production server. It activates the new slot and returns.
- The old production server self-terminates (`process.exit(0)` with a 1-second delay) in both `runAcceptAsync` and `retryAcceptAfterFix`, **after** `update-service.sh` completes.

The complete deploy sequence is now:

1. `blueGreenAccept` — git work, build, DB copy, .env.local symlink fix
2. `markInterruptedSessions` — mark still-running sessions as interrupted in DB
3. `copyDb` — final DB snapshot into new slot
4. `spawnProdViaProxy` — proxy spawns new server, health-checks it, switches traffic (no old server kill)
5. `update-service.sh` — daemon-reload / proxy restart if files changed
6. Old production server calls `process.exit(0)` — self-terminates cleanly

## Why

The old production server is the one orchestrating the deploy. Killing it from the proxy (step 4) races with the old server's remaining work (steps 5–6). By having the old server terminate itself after its work is done, the ordering is guaranteed.
