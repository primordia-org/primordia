# Require Pi EDB todo tool

Primordia now installs and loads the `npm:@agnishc/edb-todo` Pi package for headless Pi evolve sessions. The Pi worker enforces that the package exists in each worktree, loads only that required extension while keeping general extension discovery disabled, and allows the TaskCreate/TaskList/TaskGet/TaskUpdate/TaskOutput/TaskStop tools during agent runs.

This makes structured task tracking part of the Pi evolve pipeline so non-trivial implementation work can be planned and updated consistently without relying on optional user-local Pi configuration.
