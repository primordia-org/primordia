# Task accordion session events

Session progress now nests the agent's text, reasoning, and tool-call event stream inside the task list UI. Each tracked task keeps the original simple task-list appearance and can be opened to reveal its associated events; setup-time events are grouped into a virtual "Setup" task, and events emitted after all tasks complete continue to attach to the final task.

This keeps Pi/agent task progress and detailed execution history in one scannable accordion instead of splitting the to-do summary from the detailed log below it. The task list preserves the original progress header, weighted progress bar, compact task rows, and up/down chevron expansion behavior while avoiding an extra nested wrapper and redundant padding around the task progress UI.
