# Dead Simple Progress Monitor Plan

## Goal

Replace the Pi-only `@agnishc/edb-todo` task extension with a Primordia-owned progress monitor that is deliberately shaped around the Evolve Session UX and can be used by **Pi**, **Claude Code**, and **Codex** without harness-specific task systems.

The attached screenshot shows the UX direction we want to keep: a compact agent run card with identity, state, task count, a segmented progress bar, a short current-task list, and run metrics. It also shows why the current implementation is too fragile: the UI leaks internal task IDs like `To-do #t26`, requires many task-management calls, and depends on Pi extension state instead of a tiny protocol Primordia controls.

## Work backwards from the UX

### What the user should see

For each agent run, the session page should render one simple progress panel:

1. **Run header**
   - Harness icon/name, model name, and status: `starting`, `running…`, `blocked`, `failed`, `done`.
   - Optional live dot/spinner.
2. **Progress summary**
   - `N of M complete`.
   - A segmented progress bar with one segment per step.
   - Weighted steps are optional later; the first version should treat each step equally.
3. **Step list**
   - Small, human-readable labels only.
   - States: `pending`, `active`, `done`, `blocked`, `failed`, `skipped`.
   - The active row can show a present-tense label such as `Validating changes…`.
   - No exposed task IDs, priorities, owner fields, dependency graphs, or nested task metadata.
4. **Expandable details per step**
   - Existing text/thinking/tool events are grouped under the active step.
   - Setup output before the first step belongs to a virtual `Setup` step.
5. **Footer metrics**
   - Duration, input tokens, output tokens, and cost when available.

### What the agent should have to do

The agent should only need to send three kinds of progress signals:

1. `plan` — declare the short list of visible steps.
2. `step` — mark exactly one step active/done/blocked/failed/skipped.
3. `note` — optional short user-facing status text.

Everything else should be inferred by Primordia:

- Completion count from step states.
- Active step from the latest `step` event.
- Tool/text grouping from event order.
- Terminal state from the existing `result` event.
- Metrics from the existing `metrics` event.

## Non-goals

- No task database.
- No dependency graph.
- No priority sorting.
- No background task process management.
- No separate task IDs visible to users.
- No required extension install from npm.
- No generic project-management feature; this is only an Evolve session progress protocol.

## Proposed protocol

Add a new NDJSON event type to `lib/session-events.ts`:

```ts
export type ProgressStepStatus =
  | 'pending'
  | 'active'
  | 'done'
  | 'blocked'
  | 'failed'
  | 'skipped';

export type SessionEvent =
  // existing events...
  | {
      type: 'progress_plan';
      steps: Array<{
        id: string;        // stable slug, not shown by default
        label: string;     // short visible row text
      }>;
      ts: number;
    }
  | {
      type: 'progress_step';
      id: string;
      status: ProgressStepStatus;
      label?: string;      // optional replacement visible text
      detail?: string;     // optional one-line status/detail
      ts: number;
    }
  | {
      type: 'progress_note';
      message: string;
      ts: number;
    };
```

Recommended generated step IDs are boring slugs: `inspect`, `implement`, `preview`, `validate`, `changelog`, `commit`, `final`. The UI may keep them internally for grouping, but it should render labels, not IDs.

### Minimal file writer

Create a tiny script, for example `scripts/progress-monitor.ts`, and expose it via `package.json`:

```json
{
  "scripts": {
    "progress": "bun scripts/progress-monitor.ts"
  }
}
```

The script appends validated events to `.primordia-session.ndjson` in the current worktree:

```bash
bun run progress plan '[{"id":"inspect","label":"Inspect relevant files"},{"id":"implement","label":"Implement changes"},{"id":"validate","label":"Validate changes"}]'

bun run progress step inspect active
bun run progress step inspect done
bun run progress step implement active --detail "Editing session progress rendering"
bun run progress note "Running typecheck"
```

Rules:

- Resolve the NDJSON path as `process.cwd()/.primordia-session.ndjson`.
- Refuse to run if the file does not exist, so the command cannot accidentally create unrelated logs.
- Validate all JSON and enum values.
- Keep the script dependency-free.
- Append exactly one JSON object per invocation.
- Exit non-zero with a short message on invalid input.

This makes the progress monitor usable by every harness because every harness can run shell commands.

## Agent prompt contract

Inject the same progress instructions into Pi, Claude Code, and Codex worker prompts:

> Primordia shows users a simple progress panel. Use `bun run progress` to keep it current. At the beginning of every requested change, declare 4–7 user-visible steps with `bun run progress plan '[...]'`. Do not create a detailed task tree. Mark a step `active` before working on it and `done` as soon as it is complete. Use `blocked` or `failed` only when the user needs to know work cannot proceed. Labels must be short, imperative, and user-facing. Do not expose internal IDs. Prefer stages such as inspect, implement, set preview, validate, changelog, commit, final.

Additional prompt rules:

- If the request is docs-only, still use a short plan, but skip app preview if no page is relevant.
- Do not call old Todo tools when the progress command is available.
- Do not create subtasks for every file or command.
- Keep step labels stable; use `detail` for transient text.

## UI rendering rules

Update `EvolveSessionView` to derive progress from `progress_*` events first:

1. Find the latest `progress_plan` in the current agent section.
2. Apply later `progress_step` events by ID.
3. If there is no active step and not all steps are terminal, mark the first incomplete step as visually current.
4. Group text/thinking/tool events under the latest active step by event order.
5. Render old TodoWrite/Pi task events only as a backward-compatible fallback for historical sessions.

Progress math:

- `complete = count(done | skipped)`.
- `total = steps.length`.
- `failed` and `blocked` do not count as complete.
- If there is no plan, keep the existing virtual Setup/current log fallback.

## Harness migration plan

### Phase 1 — Add protocol beside existing Todo support

- Add `progress_*` event types.
- Add `scripts/progress-monitor.ts` and `bun run progress`.
- Teach the session UI to prefer `progress_*` events.
- Keep current Todo rendering for historical sessions and as a temporary fallback.

### Phase 2 — Prompt all harnesses to use the command

- Claude Code worker: add the shared progress prompt.
- Pi worker: remove the EDB todo requirement from the prompt, but leave the extension loaded only behind a temporary compatibility flag if needed.
- Codex worker: add the same prompt and stop relying on Codex `todo_list` normalization for the primary UX.

### Phase 3 — Remove EDB todo dependency

- Delete Pi installation/loading of `@agnishc/edb-todo`.
- Remove `TaskCreate`, `TaskList`, `TaskGet`, `TaskUpdate`, `TaskOutput`, and `TaskStop` from the headless Pi tool list.
- Remove EDB-specific prompt text from project instructions.
- Keep rendering support for historical task events in `EvolveSessionView`.

### Phase 4 — Tighten UX

- Rename the session panel from `Tasks` to `Progress` if user testing confirms that is clearer.
- Hide implementation details such as tool-call names by default under each step.
- Show the latest `progress_note` as a compact status line under the active step.
- Add one or two sample NDJSON fixtures for renderer tests.

## Acceptance criteria

- New sessions from Pi, Claude Code, and Codex can all produce the same progress panel with only shell access.
- No new npm package is required for progress tracking.
- The UI never shows synthetic task labels like `To-do #t26` for new sessions.
- A malformed progress command fails safely without corrupting `.primordia-session.ndjson`.
- Historical sessions that contain TodoWrite or Pi Task events still render.
- The implementation remains append-only and compatible with existing SSE streaming.

## Open questions

1. Should `bun run progress plan` replace the current plan or only the current agent-section plan? Recommendation: latest plan within the current `section_start` wins.
2. Should step IDs be user-provided or generated by the script? Recommendation: allow explicit IDs so agents can update steps reliably, but validate them as lowercase slugs.
3. Should the command support batch updates? Recommendation: no for v1. One event per invocation keeps the script and parser obvious.
4. Should this become an MCP/tool API later? Recommendation: only if shell commands prove insufficient across harnesses.
