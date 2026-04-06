# Show todo list contents in session page

## What changed

Modified `summarizeToolUse` in `lib/evolve-sessions.ts` so that `TodoWrite` tool calls display the actual todo items inline rather than the generic "Update todo list" label.

Before:
```
- 🔧 Update todo list
```

After:
```
- 🔧 Updated todos: ✅ Read architecture docs · 🔄 Write API route · ⬜ Update tests
```

Each todo item is prefixed with a status emoji:
- ✅ `completed`
- 🔄 `in_progress`
- ⬜ `pending`

Items are joined with ` · ` separators on a single line, keeping the existing tool call rendering intact (one bullet point per tool call).

## Why

When Claude runs during an evolve session it frequently updates its internal todo list via `TodoWrite`. Previously these calls only showed as "Update todo list" with no detail, making it impossible to see what tasks Claude had planned or which ones it had completed. Now the full task list with statuses is visible directly in the session page progress log.
