# Primordia CLI Sketch

This is a quick product and architecture sketch for a future `primordia` CLI that moves Primordia's core functionality out of the Next.js app and reverse proxy. The goal is to make Primordia Core usable from any frontend stack: Next.js, Astro, native desktop, terminal-only workflows, or custom hosted UIs.

## North Star

`primordia` should be the stable automation layer for self-modifying apps:

- Manage instances, branches, worktrees, previews, and deployments.
- Run evolve agents with consistent session logs and progress events.
- Expose the same capabilities through CLI commands, a local API, and reusable TypeScript modules.
- Treat web UI, reverse proxy, and Next.js pages as optional clients of the core.

In this model, the current app becomes one possible frontend for Primordia Core rather than the place where the core lives.

## CLI Shape

```bash
primordia init [path]
primordia status
primordia doctor

primordia evolve "Add a pricing page"
primordia evolve --from-branch feature-x "Polish the UI"
primordia followup <session> "Make the hero shorter"
primordia abort <session>

primordia session list
primordia session show <session>
primordia session logs <session> --follow
primordia session diff <session>
primordia session accept <session>
primordia session reject <session>

primordia branch list
primordia branch graph
primordia branch parent <branch>
primordia branch sync <branch>

primordia preview start <branch|session>
primordia preview stop <branch|session>
primordia preview url <branch|session>
primordia preview logs <branch|session> --follow

primordia deploy <branch|session>
primordia rollback list
primordia rollback apply <slot>

primordia auth login
primordia auth status
primordia credential set <source>
primordia preset list
primordia preset create

primordia core serve --stdio
primordia core serve --http :7331
```

## Core Concepts

### Instance

A directory with Primordia metadata, git state, a SQLite database, and optional app-specific adapters.

```bash
primordia init ./my-astro-app
primordia status --json
```

The instance should not assume Next.js. It only needs:

- A git repository.
- A package/runtime command adapter.
- Optional preview and deploy adapters.
- A Primordia metadata directory or database.

### Adapters

Primordia Core should call declared adapters instead of hard-coded Next.js commands.

```ts
type PrimordiaAdapter = {
  install?: string;
  dev?: string;
  build?: string;
  typecheck?: string;
  test?: string;
  previewUrl?: (context: PreviewContext) => string;
  deploy?: string | DeployFunction;
};
```

Example config:

```json
{
  "runtime": "bun",
  "install": "bun install",
  "dev": "bun run dev --host 127.0.0.1 --port $PORT",
  "build": "bun run build",
  "typecheck": "bun run typecheck",
  "preview": {
    "mode": "process",
    "basePathEnv": "PUBLIC_BASE_PATH"
  }
}
```

### Session

A session is the durable unit of evolve work. It should remain framework-agnostic:

- Initial request and follow-ups.
- Selected harness, model, billing source, and credentials reference.
- Worktree path and branch parentage.
- Structured NDJSON event log.
- Progress plan and step events.
- Preview process metadata, if any.
- Accept/reject/deploy state.

The current `.primordia-session.ndjson` format is a good foundation and should become a core contract.

### Preview

The CLI should support previews without requiring the reverse proxy:

```bash
primordia preview start my-session
primordia preview url my-session
```

Preview modes could include:

1. `none` — no preview, terminal-only changes.
2. `process` — spawn the app's dev command on an assigned port.
3. `proxy` — use Primordia's reverse proxy package if installed.
4. `external` — call a user-provided command that returns a URL.

The current reverse proxy can become an optional package or adapter for blue/green routing and path-based preview URLs.

## Package Split

A likely package split:

| Package | Responsibility |
|---|---|
| `@primordia/core` | Sessions, worktrees, branch parentage, progress logs, agent orchestration, config, adapters |
| `@primordia/cli` | `primordia` executable and terminal UI |
| `@primordia/server` | Optional HTTP/stdio API around core for frontends and desktop apps |
| `@primordia/reverse-proxy` | Optional blue/green and preview routing |
| `@primordia/next-ui` | Current Next.js UI as a client of the core API |

## Local API Mode

A frontend that does not want to shell out can run Primordia Core as a local service:

```bash
primordia core serve --http 127.0.0.1:7331
```

Possible endpoints:

```http
POST /sessions
GET  /sessions
GET  /sessions/:id
POST /sessions/:id/followups
POST /sessions/:id/abort
POST /sessions/:id/accept
POST /sessions/:id/reject
GET  /sessions/:id/events
GET  /sessions/:id/diff

POST /previews/:id/start
POST /previews/:id/stop
GET  /previews/:id/logs

GET  /branches
GET  /branches/graph
POST /branches/:branch/sync
```

This lets Astro, Electron, Swift, Tauri, or mobile clients consume the same evolve engine.

## Example Workflows

### Terminal-only evolve

```bash
primordia evolve "Add keyboard shortcuts to settings" --no-preview
primordia session logs latest --follow
primordia session diff latest
primordia session accept latest
```

### Astro frontend

```bash
cd my-astro-app
primordia init
primordia adapter set dev "bun run dev --host 127.0.0.1 --port $PORT"
primordia adapter set build "bun run build"
primordia evolve "Create a docs landing page"
primordia preview start latest
```

### Current Primordia web app

The Next.js app would call `@primordia/core` directly in-process during development, or talk to `primordia core serve` in production-like deployments. Existing API routes become thin wrappers.

## Migration Plan

1. Extract pure helpers first: branch graph, branch parentage, git runtime, progress monitor, session events, model/preset definitions.
2. Define a stable `PrimordiaCore` TypeScript interface around session lifecycle operations.
3. Move worktree creation, agent execution, preview process management, and accept/reject into core services.
4. Convert Next.js API routes to call the core interface with minimal request/response mapping.
5. Add the `primordia` CLI on top of the same interface.
6. Make the reverse proxy an optional preview/deploy adapter.
7. Document adapter contracts for non-Next.js apps.

## Open Questions

- Should core store state in the existing SQLite schema, a `.primordia/` directory, or support both?
- Should credentials live in core or remain frontend-owned with explicit credential providers?
- Should `primordia core serve` be long-running by default, or should most commands be direct one-shot invocations?
- How much terminal UI should the CLI provide versus plain JSON output for scripts?
- What is the minimum adapter contract for safe accept/deploy across very different app stacks?

## Recommended First Milestone

Build `primordia session` and `primordia preview` around the existing repo internals without changing user-facing behavior. The CLI can initially wrap current TypeScript modules, then those modules can be hardened into `@primordia/core` once the command boundaries feel right.
