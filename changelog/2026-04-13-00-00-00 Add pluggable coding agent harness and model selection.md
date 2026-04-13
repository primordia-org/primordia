# Add pluggable coding agent harness and model selection

## What changed

- **`lib/agent-config.ts`** (new): Central registry of supported coding agent harnesses and the models each harness offers. Currently defines one harness (`claude-code`) with three model options (Sonnet 4 default, Opus 4, Haiku 4). Adding future harnesses only requires extending this file.

- **`components/EvolveRequestForm.tsx`** (new): Shared form component used by both the `/evolve` page and the floating dialog. Contains the textarea, file attachments, submit button, and a collapsible **"Advanced"** section (gear icon toggle) with two dropdowns:
  - **Harness** — which coding agent to use (currently just "Claude Code")
  - **Model** — which model the harness runs on (Sonnet 4 default, Opus 4, Haiku 4)

  A `compact` prop adjusts sizing for the floating dialog. Harness and model option labels are shown without descriptions to keep the UI terse.

- **`components/EvolveSessionView.tsx`**: The follow-up changes panel now includes the same collapsible **"Advanced"** section, letting users choose harness and model for a follow-up pass. The panel layout mirrors the evolve form: Attach files button (left) and Submit button (right) on one row, followed by a horizontal separator and the Advanced toggle. The selected harness and model are sent to the `/api/evolve/followup` endpoint and applied to the worker spawned for that follow-up. The advanced options reset to defaults after each successful submission.

- **`app/api/evolve/followup/route.ts`**: Now reads optional `harness` and `model` fields from the multipart form data and attaches them to the `LocalSession` object, so the follow-up worker runs with the user's chosen agent configuration.

- **`components/EvolveForm.tsx`**: Simplified to just the page chrome (header, nav, description banner); the form itself is now `<EvolveRequestForm />`.

- **`components/FloatingEvolveDialog.tsx`**: Simplified to just the floating dialog chrome (title bar, dock buttons, resize handle); the form is now `<EvolveRequestForm compact />`.

- **`app/api/evolve/route.ts`**: Reads `harness` and `model` fields from the multipart form data and attaches them to the `LocalSession` object passed to `startLocalEvolve`.

- **`lib/evolve-sessions.ts`**: Added optional `harness` and `model` fields to the `LocalSession` interface and `WorkerConfig`. Both `startLocalEvolve` and `runFollowupInWorktree` now forward the session's `model` to the spawned worker process.

- **`scripts/claude-worker.ts`**: Reads the optional `model` field from its config file and passes it as `options.model` to the `query()` call, letting the SDK use the caller-specified model instead of the harness default.

## Why

The system previously had only one hardwired path: Claude Code using its built-in default model. This change lays the structural groundwork to support additional harnesses and gives users (with a non-coder-friendly UI) the ability to choose the model used for a session — useful for trading off capability vs. speed vs. cost.
