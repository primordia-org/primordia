# Show todo progress in evolve sessions

The running agent section on evolve session pages now renders a dedicated Todo List panel below the live log entries whenever the agent uses todo tools. The panel derives the current todo state from streamed `TodoWrite` and Pi `TaskCreate`/`TaskUpdate` events, including task status, priority, IDs, active task highlighting, and completion counts.

This keeps the existing logs visible while introducing the todo list as a clearer progress indicator for future agent-progress UX work.
