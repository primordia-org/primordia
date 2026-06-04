# Split compound Pi todo tasks

Pi evolve sessions now explicitly tell agents to split compound task titles into sub-tasks or smaller sibling tasks. If a task title combines multiple outcomes with wording like “and” — for example, “Implement layout utility and ASCII renderer” — the Pi worker prompt asks the agent not to track that as a single item.

This makes the required EDB todo plan more granular and easier to follow in the evolve session task accordion, especially when one implementation stage naturally contains multiple independent deliverables.
