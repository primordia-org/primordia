# Show todo progress in evolve sessions

Evolve session agent sections now render a dedicated Todo List panel whenever the agent uses todo tools, including after the agent has finished. The panel derives the current todo state from streamed `TodoWrite` and Pi `TaskCreate`/`TaskUpdate` events, shows each task with a status icon and completion count, and keeps item rows uncluttered by omitting internal metadata like task IDs and priority labels. Completed steps are muted but not struck through so they remain easy to read.

This keeps the existing logs visible while introducing the todo list as a clearer progress indicator for future agent-progress UX work.
