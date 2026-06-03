# Combine tasks into progress

The evolve session progress panel now folds task tracking into the Progress section instead of rendering a separate Tasks section. The progress bar remains at the top of the combined panel, with the task list directly underneath it so it visually flows inside the parent progress container.

By default, the task list shows only a slice of the full list: the currently active task, the next pending task, or the final task once all work is complete. Completed and other pending tasks stay hidden without introducing collapsed-only labels or completion placeholder text, and the visible task text remains selectable for copy/paste.

The task list uses direct-manipulation icon handles instead of a standard disclosure row: single vertical chevron controls sit above and below the visible task slice, flip when expanded, and toggle a smooth height animation that reveals the rest of the original task list in place.
