# Restore Pi todo names

Pi evolve sessions now correctly render names for tasks created through batched `TaskCreate` calls.

The regression happened because Pi task-tracking guidance changed to require agents to create their initial task list in one batched `TaskCreate` call using `input.tasks`. The session UI still treated every `TaskCreate` event as a single task with a top-level `content` field, so batched creates produced an unnamed placeholder instead of the individual task names.

The task renderer now expands `TaskCreate` batches into separate tracked tasks, preserves each task's content/priority/active form, and gives batch-created tasks synthetic IDs so later `TaskUpdate` events can attach to the correct entries.
