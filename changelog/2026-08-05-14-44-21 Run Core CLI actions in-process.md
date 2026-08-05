# Run Core CLI actions in-process

Core API route-actions now execute the shared Primordia command tree directly with an injected `ProcessCtx` instead of spawning a new CLI subprocess per request.

This keeps CLI and API behavior aligned while avoiding the per-request memory overhead of launching a separate Bun process. CLI command handlers now read cwd, env, stdin/stdout/stderr, signals, process id, process kill, and exits through the injected context rather than reaching directly into process globals.

The tiny command framework is now split by responsibility:

- `lib/tiny-command/common.ts` defines shared command metadata, argument, API, and `ProcessCtx` types plus process helpers.
- `lib/tiny-command/cli.ts` instantiates command definitions as a terminal CLI.
- `lib/tiny-command/rest.ts` instantiates the same command definitions as an HTTP REST/route-action API.

`scripts/primordia-command-handlers.ts` now owns both the Primordia command definitions and their handlers. `scripts/primordia.ts` passes those definitions to the CLI runtime, while `app/api/core/[[...path]]/route.ts` passes them to the REST runtime and only supplies Primordia-specific auth/cwd/OpenAPI configuration.

`ProcessCtx` also includes a small `console` helper (`log`, `error`, and `warn`) backed by the injected output streams, so CLI command handlers can write human-readable output without reimplementing line-writing helpers. The command handler module shadows the injected context as `process` to keep the diff close to the original process-global style.
