# Primordia CLI Sketch

This is a quick product and architecture sketch for a future `primordia` CLI that moves Primordia's core functionality out of the Next.js app and reverse proxy. The goal is to make Primordia Core usable from any frontend stack: Next.js, Astro, native desktop, terminal-only workflows, or custom hosted UIs.

## North Star

`primordia` should be the stable automation layer for self-modifying apps:

- Manage instances, threads, worktrees, previews, and deployments.
- Run evolve agents with consistent thread logs and progress events.
- Expose the same capabilities through CLI commands, a local API, and reusable TypeScript modules.
- Treat web UI, reverse proxy, and Next.js pages as optional clients of the core.

In this model, the current app becomes one possible frontend for Primordia Core rather than the place where the core lives.

## CLI Shape

```bash
primordia init [path]
primordia status
primordia doctor

primordia evolve "Add a pricing page"
primordia evolve --thread feature-x "Polish the UI"
primordia followup <thread> "Make the hero shorter"
primordia abort <thread>

primordia thread list
primordia thread show <thread>
primordia thread logs <thread> --follow
primordia thread diff <thread>
primordia thread graph
primordia thread sync <thread>
primordia thread accept <thread>
primordia thread reject <thread>

primordia preview start <thread>
primordia preview stop <thread>
primordia preview url <thread>
primordia preview logs <thread> --follow

primordia deploy <thread>
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

### Thread

A thread is the durable user-facing unit of evolve work. It combines what Primordia currently calls a session and the backing branch into one concept, so users do not have to choose between two parallel nouns for the same line of work.

A thread should remain framework-agnostic and track:

- Initial request and follow-ups.
- Selected harness, model, billing source, and credentials reference.
- Worktree path and backing git branch metadata.
- Structured NDJSON event log.
- Progress plan and step events.
- Preview process metadata, if any.
- Accept/reject/deploy state.

Git branches still exist internally because they are the safest implementation primitive for diffs, merges, parentage, and rollback. The CLI should expose them as thread details, not as a separate top-level workflow. The current `.primordia-session.ndjson` format is a good foundation, but the core contract should be renamed around thread events over time.

### Preview

The CLI should support previews without requiring the reverse proxy:

```bash
primordia preview start my-thread
primordia preview url my-thread
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
| `@primordia/core` | Threads, worktrees, git parentage, progress logs, agent orchestration, config, adapters |
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
POST /threads
GET  /threads
GET  /threads/:id
POST /threads/:id/followups
POST /threads/:id/abort
POST /threads/:id/accept
POST /threads/:id/reject
POST /threads/:id/sync
GET  /threads/:id/events
GET  /threads/:id/diff
GET  /threads/graph

POST /previews/:id/start
POST /previews/:id/stop
GET  /previews/:id/logs
```

This lets Astro, Electron, Swift, Tauri, or mobile clients consume the same evolve engine.

## Example Workflows

### Terminal-only evolve

```bash
primordia evolve "Add keyboard shortcuts to settings" --no-preview
primordia thread logs latest --follow
primordia thread diff latest
primordia thread accept latest
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

1. Extract pure helpers first: thread graph, git parentage, git runtime, progress monitor, session/thread events, model/preset definitions.
2. Define a stable `PrimordiaCore` TypeScript interface around thread lifecycle operations.
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

Build `primordia thread` and `primordia preview` around the existing repo internals without changing user-facing behavior. The CLI can initially wrap current TypeScript modules, then those modules can be hardened into `@primordia/core` once the command boundaries feel right.
