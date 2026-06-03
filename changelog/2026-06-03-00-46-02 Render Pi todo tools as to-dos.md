# Render Pi todo tools as to-dos

## What changed

- Updated the Evolve Session event renderer so Pi EDB todo tool calls (`TaskCreate`, `TaskList`, `TaskGet`, and `TaskUpdate`) render with the structured 📋 To-do presentation instead of appearing as generic tool calls.
- Kept legacy `TodoWrite` events on the same To-do display path so todo rendering is consistent across agent harnesses.
- Added status/priority-aware styling for Pi todo updates, including completed, in-progress, blocked, failed, and pending states.
- Ignored local `.pi/tasks/` state files created by the required Pi todo tooling so they do not appear as project changes.
- Adjusted localized timestamp hydration to satisfy the current React hooks lint rule while preserving the server-to-browser timezone swap.

## Why

Pi evolve sessions now use the EDB todo tool family for task tracking. Rendering those tool calls as to-dos makes the Evolve Session UI clearly show the agent's plan/progress rather than hiding it among generic wrench tool entries.
