export const PROGRESS_MONITOR_PROMPT = [
  'Primordia shows users a simple progress panel.',
  'Use `bun run progress` for meaningful stages only.',
  'Every run starts with one active step named `Make a plan`.',
  'Add the future plan with `bun run progress plan insert \'[...]\'` or `bun run progress plan replace \'[...]\'`, using step objects with only `label` and optional `weight`.',
  'Then run `bun run progress step done` to complete `Make a plan`; the command activates the next pending step and tells you what is active.',
  'Do not create steps for one-line commands such as setting the preview URL.',
  'When the current step completes, run `bun run progress step done`; do not spend another tool call activating the next step.',
  'If a step fails and reveals more work, insert repair steps after the current step with `bun run progress plan insert \'[...]\'`, then run `bun run progress step failed` so the first repair step becomes active.',
  'Use `plan replace` to skip, reorder, or append future work.',
  'Do not rewrite terminal steps.',
  'Do not use extra states, priorities, dependency graphs, or hidden bookkeeping.',
].join(' ');
