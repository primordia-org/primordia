# Carry over incomplete progress tasks

Follow-up evolve runs now detect when the previous agent turn left the Primordia progress task list unfinished. The follow-up prompt includes the current task list state so the next agent continues from the active task instead of starting a fresh `Make a plan` list.

The session thread progress UI also seeds each new agent section with the unfinished list when appropriate, so follow-up details render under the carried-over task list rather than only virtual `Make a plan` / `Wrap-up` items.

The progress reducer and `bun run progress` helper now support appending newly discovered work after a run has reached the virtual Wrap-up state, allowing `bun run progress plan insert '[...]'` to add and activate additional steps instead of being ignored or rejected.
