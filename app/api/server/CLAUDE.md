# Server API — Architecture Reference

This directory contains preview/process-management endpoints that are not thread mutations themselves.

- `kill-restart/route.ts` — restarts a thread preview server through the shared process manager.
- `logs/route.ts` — streams a thread preview server's `.primordia-next-server.log` over SSE.
- `hotswap-db/route.ts` — internal loopback-only endpoint used by upstream sync to close and reopen the preview SQLite DB after a fresh production snapshot is copied in.

Thread and agent-run endpoints live under `app/api/thread/`.
