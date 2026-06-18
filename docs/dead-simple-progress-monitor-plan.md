# Dead Simple Progress Monitor Plan

## Goal

Replace the Pi-only `@agnishc/edb-todo` task extension with a Primordia-owned progress monitor shaped around the Evolve Session UX and usable by **Pi**, **Claude Code**, and **Codex** through ordinary shell commands.

The attached screenshot shows the UX direction to preserve: a compact run card with agent identity, run state, weighted progress, a short step list, expandable details, and metrics. It also shows what to avoid: leaked internal IDs such as `To-do #t26`, too many progress-management calls, and a dependency on Pi extension state.

## Design principles

1. **Progress overhead must stay smaller than the work.** Do not create steps for one-line chores such as `bun run set-preview-url /evolve` or checking `git status`.
2. **Operate on the current step.** Agents should not invent or maintain step IDs. The monitor knows which step is current.
3. **The first step is always `Make a plan`.** This replaces the old virtual `Setup` bucket with a more accurate real step.
4. **Append-only beats mutation.** Do not rewrite completed or failed work. If new work appears, insert or replace future steps.
5. **The command should teach the agent what to do next.** Every success and error prints concise context, including the active or next step.
6. **No generic project manager.** This is only a tiny Evolve-session progress protocol.

## UX target

For each agent run, the session page renders one progress panel:

1. **Run header** — harness, model, status (`starting`, `running…`, `failed`, `done`), and optional live indicator.
2. **Progress summary** — `N of M complete` plus a weighted segmented progress bar.
3. **Step list** — short user-facing labels, no IDs. States: `pending`, `active`, `done`, `failed`.
4. **Expandable details** — existing thinking/text/tool events grouped under the single active/current step. Before the agent writes a plan, that step is `Make a plan`; after all steps finish, remaining output belongs to virtual `Wrap-up`.
5. **Metrics footer** — duration, tokens, and cost when available.

## Agent workflow

Every run starts with one active step created by Primordia:

```text
Make a plan
```

The agent fills in future steps, then marks `Make a plan` done. Because commands operate on the current step, no step IDs are needed.

```bash
bun run progress plan insert '[{"label":"Inspect relevant files","weight":1},{"label":"Implement changes","weight":4},{"label":"Validate changes","weight":2},{"label":"Finish up","weight":1}]'
# stdout: inserted 4 future steps after 'Make a plan'. current step 'Make a plan'.

bun run progress step done
# stdout: step 'Make a plan' done. step 'Inspect relevant files' active. 1/5 complete, 11% weighted.

# ...read files...
bun run progress step done
# stdout: step 'Inspect relevant files' done. step 'Implement changes' active. 2/5 complete, 22% weighted.

# ...edit files...
bun run progress step done
# stdout: step 'Implement changes' done. step 'Validate changes' active. 3/5 complete, 67% weighted.

# Include one-liners such as set-preview-url inside the nearest real step.
bun run set-preview-url /evolve
bun run progress step done
# stdout: step 'Validate changes' done. step 'Finish up' active. 4/5 complete, 89% weighted.

# ...changelog/commit/final summary...
bun run progress step done
# stdout: step 'Finish up' done. no next step. 5/5 complete, 100% weighted.
```

If validation fails, do **not** pretend the original validation passed. Insert the newly discovered repair work after the current validation step, then mark validation failed so the first inserted repair step becomes active.

```bash
bun run progress plan insert '[{"label":"Fix type import errors","weight":1},{"label":"Validate changes","weight":1}]'
# stdout: inserted 2 future steps after 'Validate changes'. current step 'Validate changes'.

bun run progress step failed
# stdout: step 'Validate changes' failed. step 'Fix type import errors' active.

# ...fix the issue...
bun run progress step done
# stdout: step 'Fix type import errors' done. step 'Validate changes' active.
```

If the future plan is wrong, replace all pending future steps instead of editing old steps:

```bash
bun run progress plan replace '[{"label":"Validate docs","weight":1},{"label":"Finish up","weight":1}]'
# stdout: replaced 2 future steps after 'Implement changes'. current step 'Implement changes'.
```

## Command API

Only three verbs are needed:

```bash
bun run progress plan insert '<steps-json>'
bun run progress plan replace '<steps-json>'
bun run progress step <done|failed>
bun run progress note '<message>'
```

### `plan insert`

Inserts newly discovered future steps after the current step.

- Input is a JSON array of steps.
- Each step has `label` and optional positive integer `weight`.
- No `id` field is accepted.
- The current step stays current; inserted steps become pending until the current step is marked `done` or `failed`.
- This is the normal command for the initial plan because the current step starts as `Make a plan`.

### `plan replace`

Replaces all future pending steps after the current step.

- Use this to skip, reorder, or append future work.
- Completed and failed steps before/current are preserved.
- No terminal history is rewritten.
- This also works for the initial plan because the future is empty.

### `step`

Updates the current step only.

- `done` marks the current step complete and automatically activates the next pending step by order.
- `failed` marks the current step failed and automatically activates the next pending step by order.
- There is no `active` action; active is derived by the monitor.
- There are no step IDs, no `blocked`, no `skipped`, no `--force`, and no dependency graph.

### `note`

Optional. Use sparingly for a short status that is useful to the user but not worth a new step.

## Proposed NDJSON protocol

Add progress events to `lib/session-events.ts`:

```ts
export type ProgressStepStatus = 'pending' | 'active' | 'done' | 'failed';

export type ProgressPlanStep = {
  label: string;
  weight?: number;
};

export type SessionEvent =
  // existing events...
  | {
      type: 'progress_plan';
      mode: 'insert' | 'replace_future';
      steps: ProgressPlanStep[];
      ts: number;
    }
  | {
      type: 'progress_step';
      status: 'done' | 'failed';
      activatedNextLabel?: string | null;
      ts: number;
    }
  | {
      type: 'progress_note';
      message: string;
      ts: number;
    };
```

The command writes the events. The UI never trusts agent-provided IDs because there are none.

## Initial state

When an agent section starts, the reducer begins with this state even before any `progress_*` event exists:

```ts
{
  steps: [
    { label: 'Make a plan', weight: 1, status: 'active' }
  ],
  currentIndex: 0
}
```

This removes the need for `step active` and replaces the old virtual `Setup` grouping with a real, visible first step.

## Reducer rules

The session UI and command helper both reduce events into this state:

```ts
interface ProgressState {
  steps: Array<{
    label: string;
    weight: number;
    status: ProgressStepStatus;
  }>;
  currentIndex: number | null;
}
```

Rules:

1. Start every agent section with one active step: `Make a plan`.
2. `progress_plan(mode: 'insert')` inserts the new steps immediately after `currentIndex` without changing the current step.
3. `progress_plan(mode: 'replace_future')` removes all pending steps after `currentIndex`, then appends the new steps.
4. `progress_step(done | failed)` applies to `currentIndex`; then the reducer activates the next pending step by order and stores its index as `currentIndex`.
5. If no pending step remains, `currentIndex = null` and subsequent output groups under virtual `Wrap-up`.
6. Terminal steps (`done`, `failed`) are never rewritten. To recover from failure, insert repair steps after the current step before marking it failed, or replace future steps while it is still current.

These rules preserve one active step, avoid duplicate ID problems entirely, and keep the log append-only.

## Command output contract

Every command prints one concise line for the agent. Invalid commands append nothing.

Success examples:

```text
inserted 4 future steps after 'Make a plan'. current step 'Make a plan'.
replaced 2 future steps after 'Implement changes'. current step 'Implement changes'.
step 'Make a plan' done. step 'Inspect relevant files' active. 1/5 complete, 11% weighted.
step 'Validate changes' failed. step 'Fix type import errors' active.
note saved. active step 'Fix type import errors'.
```

Error examples:

```text
status 'active' is invalid. use one of: done, failed.
step JSON is invalid: expected an array of steps with label and optional positive integer weight.
step IDs are not supported. remove 'id' from step 1; steps operate by current position.
no active step. all steps are terminal; insert or replace future steps is not possible for this run.
usage: bun run progress step <done|failed>
```

Handle bad input as data, not stack traces: unknown commands, missing args, invalid JSON, bad weights, unsupported IDs, invalid statuses, and missing session logs should all produce actionable one-line messages.

## Prompt contract

Inject the same instruction into Pi, Claude Code, and Codex workers:

> Primordia shows users a simple progress panel. Use `bun run progress` for meaningful stages only. Every run starts with one active step named `Make a plan`. Add the initial future plan with `bun run progress plan insert '[...]'` or `bun run progress plan replace '[...]'`, using step objects with only `label` and optional `weight`. Do not include step IDs. Then run `bun run progress step done` to complete `Make a plan`; the command activates the next pending step and tells you what is active. Do not create steps for one-line commands such as setting the preview URL. When the current step completes, run `bun run progress step done`; do not spend another tool call activating the next step. If a step fails and reveals more work, insert repair steps after the current step with `bun run progress plan insert '[...]'`, then run `bun run progress step failed` so the first repair step becomes active. Use `plan replace` to skip, reorder, or append future work. Do not rewrite terminal steps. Do not use active/blocked/skipped states, priorities, dependency graphs, or hidden task IDs.

## UI rendering rules

Update `EvolveSessionView` to prefer `progress_*` events:

1. Initialize each agent section with `Make a plan` active.
2. Apply later `progress_plan` and `progress_step` events with the reducer above.
3. Group text/thinking/tool events under the active `currentIndex` at the time they arrive.
4. If no step is active, group post-terminal output under virtual `Wrap-up`.
5. Render old TodoWrite/Pi task events only as a backward-compatible fallback for historical sessions.

Progress math:

- Step count: `completeSteps = count(done)` and `totalSteps = steps.length`.
- Weighted bar: `completeWeight = sum(weight for done)` and `totalWeight = sum(weight for all steps)`.
- `failed` does not count as complete.

## Migration plan

### Phase 1 — Add protocol beside existing Todo support

- Add ID-free `progress_*` event types with v1 weights.
- Add `scripts/progress-monitor.ts` and `bun run progress` with validation, reduction, automatic next-step activation, plan insertion, future replacement, and contextual output.
- Teach the session UI to prefer `progress_*` events and initialize `Make a plan` for new agent sections.
- Keep current Todo rendering for historical sessions.

### Phase 2 — Prompt all harnesses to use the command

- Claude Code worker: add the shared progress prompt.
- Pi worker: remove EDB todo instructions from the prompt.
- Codex worker: add the same prompt and stop relying on Codex `todo_list` normalization for the primary UX.

### Phase 3 — Remove EDB todo dependency

- Delete Pi installation/loading of `@agnishc/edb-todo`.
- Remove `TaskCreate`, `TaskList`, `TaskGet`, `TaskUpdate`, `TaskOutput`, and `TaskStop` from the headless Pi tool list.
- Remove EDB-specific project instructions.
- Keep historical task-event rendering.

## Acceptance criteria

- Pi, Claude Code, and Codex can produce the same progress panel with shell access only.
- Agents normally need one command per meaningful stage transition, not two.
- One-liner chores are folded into nearby meaningful steps.
- Weighted progress works from day one.
- The reduced state can never contain more than one active step.
- Step IDs are impossible because the protocol operates on the current step and future step order.
- Failed work is followed by inserted repair steps, not terminal rewrites or blocked states.
- Every success or error returns concise context about the active/next step and corrective action.
- No new npm package is required.
- Historical TodoWrite/Pi Task sessions still render.
