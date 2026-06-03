# Require Pi EDB todo tool

Primordia now installs and loads the `npm:@agnishc/edb-todo` Pi package for headless Pi evolve sessions. The Pi worker enforces that the package exists in each worktree, loads only that required extension while keeping general extension discovery disabled, and allows the TaskCreate/TaskList/TaskGet/TaskUpdate/TaskOutput/TaskStop tools during agent runs.

This makes structured task tracking part of the Pi evolve pipeline so implementation work can be planned and updated consistently without relying on optional user-local Pi configuration. The required Pi prompt also tells agents to always create distinct stage tasks — inspect/read, edit/implement, validate/check, and wrap up with changelog/commit/preview/final response — rather than collapsing the whole job into one broad todo item, even when the requested change seems trivial. Transient `.pi/tasks/` stores are ignored so task state does not leak into accepted code changes.
