# Server API — Architecture Reference

This directory contains preview/process-management endpoints that are not thread mutations themselves.

- `hotswap-db/route.ts` — internal loopback-only endpoint used by upstream sync to close and reopen the preview SQLite DB after a fresh production snapshot is copied in.

Thread preview server lifecycle and log operations are exposed through `/api/core/server/[threadId]/*`. Thread and agent-run endpoints live under `app/api/thread/`.
