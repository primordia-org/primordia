# Stream ThreadView server status through Primordia Core

Added `bun run primordia server status` to report the current worktree server's process status as a minimal `{ threadId, status }` payload. Its `--follow --json` mode emits newline-delimited JSON only when status changes, allowing Core clients to keep one subscription open while polling stays inside the server-side command.

ThreadView now consumes `/api/core/server/[threadId]/status?follow=true&json=true` instead of repeatedly invoking a Server Action from the browser. This reduces noisy browser-originated status requests in application logs and traces while preserving live Start Preview, Restart, offline iframe, and server-log behavior. The temporary in-page list of polling reasons has been removed.
