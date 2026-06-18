# Dead Simple Progress Monitor Plan

## Goal

Replace the Pi-only `@agnishc/edb-todo` task extension with a Primordia-owned progress monitor shaped around the Evolve Session UX and usable by **Pi**, **Claude Code**, and **Codex** through ordinary shell commands.

The attached screenshot shows the UX direction to preserve: a compact run card with agent identity, run state, weighted progress, a short step list, expandable details, and metrics. It also shows what to avoid: leaked internal IDs such as `To-do #t26`, too many progress-management calls, and a dependency on Pi extension state.

## Design principles

1. **Progress overhead must stay smaller than the work.** Do not create steps for one-line chores such as `bun run set-preview-url /evolve` or checking `git status`.
2. **The state space should make bad UI states impossible.** The reduced state has at most one active step, so all subsequent tool/text events have one obvious bucket.
3. **Append-only beats mutation.** Do not rewrite terminal steps. If new work appears, append new steps to the plan.
4. **The command should teach the agent what to do next.** Every success and error prints concise context, including the active or next step.
5. **No generic project manager.** This is only a tiny Evolve-session progress protocol.

## UX target

For each agent run, the session page renders one progress panel:

1. **Run header** — harness, model, status (`starting`, `running…`, `failed`, `done`), and optional live indicator.
2. **Progress summary** — `N of M complete` plus a weighted segmented progress bar.
3. **Step list** — short user-facing labels, no task IDs. States: `pending`, `active`, `done`, `failed`.
4. **Expandable details** — existing thinking/text/tool events grouped under the single active step. Output before the first active step belongs to virtual `Setup`; output after all steps finish belongs to virtual `Wrap-up`.
5. **Metrics footer** — duration, tokens, and cost when available.

## Agent workflow

A normal run should take very few progress commands:

```bash
bun run progress plan '[{"id":"inspect","label":"Inspect relevant files","weight":1},{"id":"implement","label":"Implement changes","weight":4},{"id":"validate","label":"Validate changes","weight":2},{"id":"finish","label":"Finish up","weight":1}]'

bun run progress step inspect active
# ...read files...
bun run progress step inspect done
# stdout: step 'inspect' done. step 'implement' active. 1/4 complete, 13% weighted.

# ...edit files...
bun run progress step implement done
# stdout: step 'implement' done. step 'validate' active. 2/4 complete, 63% weighted.

# Include one-liners such as set-preview-url inside the nearest real step.
bun run set-preview-url /evolve
bun run progress step validate done
# stdout: step 'validate' done. step 'finish' active. 3/4 complete, 88% weighted.

# ...changelog/commit/final summary...
bun run progress step finish done
# stdout: step 'finish' done. no next step. 4/4 complete, 100% weighted.
```

If validation fails, do **not** mutate the original validation step or add a blocked state. Append the new work that was discovered:

```bash
bun run progress step validate failed
# stdout: step 'validate' failed. no active step. insert follow-up steps or finish with an error.

bun run progress plan insert '[{"id":"fix","label":"Fix type import errors","weight":1},{"id":"validate2","label":"Validate changes","weight":1}]'
# stdout: inserted 2 steps after 'validate'. step 'fix' active.

# ...fix the issue...
bun run progress step fix done
# stdout: step 'fix' done. step 'validate2' active.
```

## Command API

Only three verbs are needed:

```bash
bun run progress plan '<steps-json>'
bun run progress plan insert '<steps-json>'
bun run progress step <id> <active|done|failed>
bun run progress note '<message>'
```

### `plan`

Sets the initial visible plan for the current agent run. It should be called once near the start of work.

- Input is a JSON array of steps.
- Each step has `id`, `label`, and optional positive integer `weight`.
- Weights are v1 because the UI already supports weighted progress. Defaults to `1`; use `1` for tiny, `2` for normal, and `3–5` for large.
- Plan labels should describe meaningful work stages, not individual commands.

### `plan insert`

Appends newly discovered work without rewriting history.

- Inserts after the current active step when one exists.
- Otherwise inserts after the most recent failed step.
- Otherwise appends to the end.
- If there is no active step, the first inserted step becomes active automatically.
- This replaces `blocked`, dependency graphs, `--force`, and terminal-state rewrites.

### `step`

Updates one step.

- `active` makes that step the only active step.
- `done` marks it complete and automatically activates the next pending step by plan order in the same event.
- `failed` marks it failed and leaves no active step, so the agent can insert repair steps or stop with an error.
- Terminal steps cannot be changed. Add a new step instead.

### `note`

Optional. Use sparingly for a short status that is useful to the user but not worth a new step.

## Proposed NDJSON protocol

Add progress events to `lib/session-events.ts`:

```ts
export type ProgressStepStatus = 'pending' | 'active' | 'done' | 'failed';

export type SessionEvent =
  // existing events...
  | {
      type: 'progress_plan';
      mode: 'set' | 'insert';
      steps: Array<{
        id: string;
        label: string;
        weight?: number;
      }>;
      afterId?: string;
      activateFirstInserted?: boolean;
      ts: number;
    }
  | {
      type: 'progress_step';
      id: string;
      status: 'active' | 'done' | 'failed';
      activateNextId?: string | null;
      ts: number;
    }
  | {
      type: 'progress_note';
      message: string;
      ts: number;
    };
```

Notes:

- `activateNextId` is written by the command for `done`, not passed by the agent as a flag.
- `afterId` and `activateFirstInserted` are written by the command for `plan insert`.
- IDs are lowercase slugs used internally; the UI renders labels.

## Reducer rules

The session UI and command helper both reduce events into this state:

```ts
interface ProgressState {
  steps: Array<{
    id: string;
    label: string;
    weight: number;
    status: ProgressStepStatus;
  }>;
  currentStepId: string | null;
}
```

Rules:

1. `progress_plan(mode: 'set')` replaces progress state; all steps start `pending`; `currentStepId = null`.
2. `progress_plan(mode: 'insert')` inserts steps at `afterId` or appends. If `activateFirstInserted` is true, any active step is demoted to `pending`, the first inserted step becomes `active`, and `currentStepId` points to it.
3. `progress_step(active)` demotes any previous active step to `pending`, marks the requested step `active`, and sets `currentStepId`.
4. `progress_step(done)` marks the requested step `done`. If `activateNextId` exists, that next step becomes the only active step; otherwise `currentStepId = null`.
5. `progress_step(failed)` marks the requested step `failed` and sets `currentStepId = null`.
6. Terminal steps (`done`, `failed`) are never rewritten. The command rejects attempts to change them and tells the agent to insert a new step.

These rules preserve a single active step while keeping the log append-only.

## Command output contract

Every command prints one concise line for the agent. Invalid commands append nothing.

Success examples:

```text
plan saved: 4 steps, total weight 8. next step 'inspect'.
step 'inspect' active. 0/4 complete, active step 'inspect'.
step 'inspect' done. step 'implement' active. 1/4 complete, 13% weighted.
step 'validate' failed. no active step. insert follow-up steps or finish with an error.
inserted 2 steps after 'validate'. step 'fix' active.
note saved. active step 'fix'.
```

Error examples:

```text
step 'verify' not found. active step is 'validate'. available steps: inspect, implement, validate.
status 'blocked' is invalid. use one of: active, done, failed.
step 'validate' is already failed. insert a new step instead of rewriting terminal history.
no progress plan found. run: bun run progress plan '[{"id":"inspect","label":"Inspect","weight":1}]'
plan JSON is invalid: expected an array of steps with id, label, and optional positive integer weight.
usage: bun run progress step <id> <active|done|failed>
```

Handle bad input as data, not stack traces: unknown commands, missing args, invalid JSON, duplicate IDs, bad weights, unknown step IDs, invalid statuses, terminal rewrites, and missing session logs should all produce actionable one-line messages.

## Prompt contract

Inject the same instruction into Pi, Claude Code, and Codex workers:

> Primordia shows users a simple progress panel. Use `bun run progress` for meaningful stages only. At the beginning, declare 3–6 user-visible weighted steps with `bun run progress plan '[...]'`. Do not create steps for one-line commands such as setting the preview URL. Mark one step `active` before working on it. When it is complete, run `bun run progress step <id> done`; the command activates the next pending step and tells you what is active, so do not spend another tool call activating it. If a step fails and reveals more work, mark it `failed`, then append repair steps with `bun run progress plan insert '[...]'`. Do not rewrite terminal steps. Do not use blocked/skipped states, priorities, dependency graphs, or hidden task IDs.

## UI rendering rules

Update `EvolveSessionView` to prefer `progress_*` events:

1. Use the latest `progress_plan(mode: 'set')` in the current agent section, then apply later inserts and steps.
2. Group text/thinking/tool events under `currentStepId` at the time they arrive.
3. If no step is active, group pre-plan/pre-active output under virtual `Setup` and post-terminal output under virtual `Wrap-up`.
4. Render old TodoWrite/Pi task events only as a backward-compatible fallback for historical sessions.

Progress math:

- Step count: `completeSteps = count(done)` and `totalSteps = steps.length`.
- Weighted bar: `completeWeight = sum(weight for done)` and `totalWeight = sum(weight for all steps)`.
- `failed` does not count as complete.

## Migration plan

### Phase 1 — Add protocol beside existing Todo support

- Add `progress_*` event types with v1 weights.
- Add `scripts/progress-monitor.ts` and `bun run progress` with validation, reduction, automatic done-to-next activation, plan insertion, and contextual output.
- Teach the session UI to prefer `progress_*` events.
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
- Failed work is followed by inserted repair steps, not terminal rewrites or blocked states.
- Every success or error returns concise context about the active/next step and corrective action.
- No new npm package is required.
- Historical TodoWrite/Pi Task sessions still render.
