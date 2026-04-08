# Eliminate proxy JSON config files; store ports in git config

## What changed

Replaced `proxy-upstream.json` and `proxy-previews.json` with per-branch port
assignments stored directly in git config (`branch.{name}.port`).

- `scripts/reverse-proxy.ts` — now reads upstream port and preview ports from git
  config instead of JSON files; watches the git config file for instant cutover;
  preview routing uses `branch.{name}.sessionId` + `branch.{name}.port` to build a
  sessionId → port table, routing `/preview/{sessionId}` requests correctly
- `lib/evolve-sessions.ts` — preview dev servers start on their branch's pre-assigned
  port; preview URLs use session ID (`/preview/{sessionId}`) so branch names with
  `/` slashes don't collide with path segments
- `app/api/evolve/manage/route.ts` — blue/green accept uses the branch's assigned port
  instead of a random free port; updates git config instead of proxy-upstream.json
- `app/api/rollback/route.ts` — reads/writes port from git config instead of
  proxy-upstream.json
- `scripts/primordia.service` — removed `ExecStartPre` script that wrote
  proxy-upstream.json; PORT is now read from git config at service startup
- `scripts/install-service.sh` — removed proxy-upstream.json bootstrap
- `scripts/assign-branch-ports.sh` (new) — idempotent migration script that assigns
  ephemeral ports to all existing local branches

## Why

`proxy-upstream.json` was being corrupted by systemd: the `%s` format specifier in
the `ExecStartPre` printf command was expanded by systemd to `/usr/bin/bash` before
being passed to bash, producing `{port:/usr/bin/bash}` instead of valid JSON. The
escape fix (`%%s`) only partially addressed the root cause.

The deeper issue: port configuration was split across an ephemeral JSON file written
at service startup, another JSON file written when preview servers started, and the
systemd `PORT=` environment variable. Any crash or race between these writes left the
proxy with a stale or missing config.

The new design stores each branch's port once in git config (a persistent, atomic
key-value store already tracking the repo). The proxy watches the git config file
directly via `fs.watch` for immediate cutover on accepts, with a 5 s poll fallback.
The service reads its own port from git config at startup, with no intermediate file
to corrupt.
