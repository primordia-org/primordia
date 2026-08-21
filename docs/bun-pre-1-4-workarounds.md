# Bun < 1.4 bug workarounds audit

Primordia now pins Bun 1.4.0 in `mise.toml` and `package.json`. This page tracks code that was added as a workaround for Bun 1.2/1.3-era runtime or Bun/Next.js interop bugs, so each item can be re-tested and simplified if Bun 1.4 no longer needs it.

## Workarounds to investigate

### 1. Reverse proxy raw-TCP WebSocket tunnel

- **Current code:** `scripts/reverse-proxy.ts` (`handleWsUpgrade` and the external `net.createServer` listener) plus `scripts/test-hmr-proxy.ts`.
- **Original bug:** Bun 1.3.11 mishandled WebSocket proxying in two ways: `http.ClientRequest` emitted `response` instead of `upgrade` for `101 Switching Protocols`, and `http.Server` upgrade sockets reported successful `write()` calls whose bytes never reached the browser.
- **Changelog references:** `changelog/2026-04-09-21-00-00 Fix WebSocket proxy 101 error in Bun.md`, `changelog/2026-04-09-03-54-55 Fix HMR WebSocket proxy - swap backwards unshift calls.md`.
- **Why it matters:** If Bun 1.4 fixes the HTTP upgrade behavior, the proxy may be able to return to a simpler `http.Server` upgrade + upstream `http.request` implementation. The raw TCP tunnel is robust, but it duplicates HTTP parsing enough that it should remain a deliberate choice, not forgotten compatibility code.
- **Investigation prompt:** Reproduce the old failing HMR/WebSocket proxy cases on Bun 1.4 with a minimal `http.Server` upgrade proxy and upstream `http.request` implementation. If both Bun HTTP upgrade bugs are fixed, decide whether to simplify `scripts/reverse-proxy.ts`; otherwise update the comments/tests with the current Bun 1.4 status.

### 2. Daemon keepalive ref'd timer

- **Current code:** `lib/keep-process-alive.ts`, used by `scripts/service-supervisor.ts`, `scripts/scheduled-jobs.ts`, and the long-lived `primordia jobs run` path in `scripts/primordia-command-handlers.ts`.
- **Original bug:** Bun 1.3.14 could busy-loop at 100% CPU on `await new Promise(() => {})` when only unref'd handles remained.
- **Changelog reference:** `changelog/2026-08-05-16-10-38 Fix Bun daemon keepalive busy loop.md`.
- **Why it matters:** The timer helper is simple and safe, but if Bun 1.4 fixed the event-loop bug we should know whether it is still required. Even if retained, the comment should say whether it is still a compatibility workaround or just the preferred daemon pattern.
- **Investigation prompt:** On Bun 1.4, run a minimal daemon with only unref'd timers plus `await new Promise(() => {})` and measure idle CPU. If the busy loop is gone, decide whether to keep `keepProcessAlive()` for clarity or revert to a simpler await; update comments accordingly.

### 3. Direct Next CLI execution through Bun

- **Current code:** `package.json` scripts invoke `bun --bun ./node_modules/next/dist/bin/next ...` for `dev`, `build`, and `start`.
- **Original bug/workaround:** `bun run --bun next start` still followed the installed `next` package-bin shebang (`#!/usr/bin/env node`) closely enough that the long-running Next process appeared as `node` in process listings. Calling the Next CLI file through Bun directly kept the app server on the intended runtime.
- **Changelog references:** `changelog/2026-07-07-23-06-02 Run Next directly with Bun.md`, `changelog/2026-04-29-00-00-00 Use bun runtime for build and start scripts.md`, `changelog/2026-04-26-00-00-00 Speed up Accept build gates with Turbopack cache warming.md`.
- **Why it matters:** If Bun 1.4 changed package-bin `--bun` behavior, the package scripts could potentially become shorter (`bun run --bun next ...`). The current form is explicit and reliable, but it is a workaround worth verifying.
- **Investigation prompt:** Compare `bun run --bun next dev/build/start` against `bun --bun ./node_modules/next/dist/bin/next ...` on Bun 1.4. Confirm process runtimes, `bun:sqlite` availability in server/build workers, and process-manager status detection before deciding whether to simplify `package.json`.

### 4. Generated Pi model registry to avoid Turbopack external import race

- **Current code:** `lib/models.generated.json`, `lib/agent-config.ts`, and `scripts/regenerate-model-registry.ts`; `lib/pi-model-registry.server.ts` is kept only for regeneration/reference instead of being imported by page render paths.
- **Original bug/workaround:** Fresh worktrees could fail first page load when Turbopack emitted a content-hashed external import for the ESM-only pi SDK before the corresponding `.next/dev/node_modules` symlink existed.
- **Changelog reference:** `changelog/2026-05-04-00-30-00 Fix pi-coding-agent Turbopack external import failure.md`.
- **Why it matters:** This is primarily a Next.js/Turbopack+Bun worktree interop workaround rather than a confirmed Bun runtime bug, but it is one of the visible Bun-era hacks in the app. If the race is fixed under the current Bun/Next combination, importing the registry dynamically at runtime might be safe again; if not, the generated JSON remains the right boundary.
- **Investigation prompt:** In a clean Bun 1.4 worktree, temporarily restore a server render path that imports the pi SDK model registry through `serverExternalPackages`, hit a page with an empty `.next/`, and see whether the hashed external symlink race still occurs. Recommend keeping generated JSON unless the dynamic path is demonstrably reliable and simpler.

## Follow-up threads

Create one child thread from this branch for each item above. Each thread should focus on reproducing the original bug on Bun 1.4, not on removing code immediately. If a workaround is no longer needed, that thread can propose and validate the simplification in isolation.
