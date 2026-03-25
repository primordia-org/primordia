# Remove timeout and add diagnostics to restart route

## What changed

`app/api/evolve/local/restart/route.ts` was updated:

- **Removed the `setTimeout` wrapper.** The previous code deferred `bun install` + `/__nextjs_restart_dev` behind a 200 ms timeout so the browser could receive its `200 OK` first. This made failures completely invisible and harder to debug. The commands now run inline before the response is returned.
- **Added a `log()` helper** that writes each step to both `console.log` (visible in the dev server terminal) and a `diagnostics` array returned in the JSON response body. This makes it possible to see exactly what happened from either the server terminal or the browser's network tab.
- **Diagnostic output includes:** the working directory, `bun install` exit code, its full stdout and stderr, the origin being called, and the HTTP status (or error) from `/__nextjs_restart_dev`.

## Why

The restart was not working and there was no way to tell why — errors were silently swallowed inside the timeout callback. Removing the timeout and surfacing all output lets us diagnose the failure directly.
