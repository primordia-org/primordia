# Combine tasks into progress

The evolve session progress panel now folds task tracking into the Progress section instead of rendering a separate Tasks section. The progress bar remains at the top of the combined panel, with the task list directly underneath it.

By default, the task list focuses on the currently active task or the next pending task, keeping completed and other pending tasks hidden without showing a completion placeholder. The visible task text remains selectable for copy/paste.

The task list uses direct-manipulation caret handles instead of a standard disclosure row: vertical carets sit above and below the current task, flip when expanded, and toggle a smooth height animation that reveals the rest of the original task list in place.
