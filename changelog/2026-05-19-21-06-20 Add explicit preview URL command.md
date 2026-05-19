# Add explicit preview URL command

Agents can now set the evolve preview panel's target route with an explicit command instead of relying on the session UI to infer a route from free-form final text.

- Added `bun run set-preview-url /route`, which appends a structured `preview_path` event to the session NDJSON log.
- Updated evolve prompts to instruct agents to run that command when there is a single most relevant preview page.
- Changed preview URL selection to read only explicit `preview_path` events, avoiding ambiguity with prose, file paths such as `/home/exedev/primordia`, or generic instructions like `/evolve/[id]`.
- Exposed session/worktree environment variables to agent worker processes so the command can reliably find the active session log.
