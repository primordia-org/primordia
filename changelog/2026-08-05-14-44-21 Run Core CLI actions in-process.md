# Run Core CLI actions in-process

Core API route-actions now execute the shared Primordia CLI command tree directly with an injected `ProcessCtx` instead of spawning a new CLI subprocess per request.

This keeps CLI and API behavior aligned while avoiding the per-request memory overhead of launching a separate Bun process. CLI command handlers now read cwd, env, stdin/stdout/stderr, signals, process id, process kill, and exits through the injected context rather than reaching directly into process globals.

The retry also cleaned up current lint errors in thread/admin log UI code so validation can complete cleanly aside from a pre-existing reverse-proxy warning.
