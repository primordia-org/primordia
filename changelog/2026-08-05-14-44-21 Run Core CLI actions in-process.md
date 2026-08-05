# Run Core CLI actions in-process

Core API route-actions now execute the shared Primordia command tree directly with an injected command context instead of spawning a new CLI subprocess per request.

This keeps CLI and API behavior aligned while avoiding the per-request memory overhead of launching a separate Bun process. CLI command handlers now read cwd, env, stdin/stdout/stderr, signals, process id, process kill, exits, and console output through the injected context rather than reaching directly into process globals.

The tiny command framework is now split by responsibility:

- `lib/tiny-command/common.ts` defines shared command metadata, argument, API, and `CommandContext` types plus console helpers.
- `lib/tiny-command/cli.ts` instantiates command definitions as a terminal CLI.
- `lib/tiny-command/rest.ts` instantiates the same command definitions as an HTTP REST/route-action API.

`scripts/primordia-command-handlers.ts` now owns both the Primordia command definitions and their handlers. `scripts/primordia.ts` creates the CLI context and passes the definitions to the CLI runtime, while `app/api/core/[[...path]]/route.ts` creates REST request contexts and supplies Primordia-specific auth/cwd/OpenAPI configuration to the REST runtime.

`CommandContext` is shaped as `{ process, console }`, so command handlers can destructure process-like APIs separately from line-oriented console helpers. The handlers use direct function-parameter injection; no async-local storage is needed because the tiny-command runtime passes the context to each command invocation and command helpers thread it through explicitly. Handler helpers destructure `process`/`console` at the top of each function so their bodies can keep the original process-like access style and minimize noisy diffs.
