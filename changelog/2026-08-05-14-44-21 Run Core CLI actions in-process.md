# Run Core CLI actions in-process

Core API route-actions now execute the shared Primordia CLI command tree directly with an injected `ProcessCtx` instead of spawning a new CLI subprocess per request.

This keeps CLI and API behavior aligned while avoiding the per-request memory overhead of launching a separate Bun process. CLI command handlers now read cwd, env, stdin/stdout/stderr, signals, process id, process kill, and exits through the injected context rather than reaching directly into process globals.

`ProcessCtx` also includes a small `console` helper (`log`, `error`, and `warn`) backed by the injected output streams, so CLI command handlers can write human-readable output without reimplementing line-writing helpers. The command handler module shadows the injected context as `process` to keep the diff close to the original process-global style.
