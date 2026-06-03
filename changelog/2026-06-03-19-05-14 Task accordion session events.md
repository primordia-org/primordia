# Task accordion session events

Session progress now nests the agent's text, reasoning, and tool-call event stream inside the task list UI. Each tracked task renders as a disclosure row with its associated events, setup-time events are grouped into a virtual "Setup" row, and events emitted after all tasks complete continue to attach to the final task.

This keeps Pi/agent task progress and detailed execution history in one scannable accordion instead of splitting the to-do summary from the detailed log below it.
