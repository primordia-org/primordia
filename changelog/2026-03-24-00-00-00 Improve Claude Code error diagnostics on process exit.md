# Improve Claude Code error diagnostics on process exit

## What changed

- **`lib/local-evolve-sessions.ts`**: Added a `stderr` callback to the `query()` SDK options so that all stderr output from the Claude Code subprocess is captured in a `stderrLines` array. The `for await` loop is now wrapped in a `try/catch`; if the SDK throws a process-level error (e.g. `"Claude Code process exited with code 1"`), the catch block re-throws with the captured stderr appended as `\n\nStderr:\n...` — giving a concrete reason for the crash instead of just an exit code.

  For structured result-message errors (`subtype !== 'success'`), the SDK's `errors[]` array is also included in the thrown error message alongside any captured stderr.

- **`app/api/evolve/local/route.ts`**: The `.catch()` handler that records errors on the session now also surfaces `err.cause.message` (formatted as *Caused by: …* in markdown) when present. This shows the original SDK error below the enriched wrapper error, so nothing is hidden.

## Why

The previous error message was just `❌ Error: Claude Code process exited with code 1` — completely opaque. Claude Code writes the real reason for the crash (auth failure, rate limit, missing binary, etc.) to **stderr**, but nothing was capturing or forwarding that output. These changes make the full stderr visible in the evolve progress panel whenever a run fails.
