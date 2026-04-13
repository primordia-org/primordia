# Add pluggable coding agent harness and model selection

## What changed

- **`lib/agent-config.ts`** (new): Central registry of supported coding agent harnesses and the models each harness offers. Currently defines one harness (`claude-code`) with three model options (Sonnet 4 default, Opus 4, Haiku 4). Adding future harnesses only requires extending this file.

- **`components/EvolveForm.tsx`**: Added a collapsible **"Advanced"** section (gear icon toggle) beneath the submit row. It exposes two dropdowns:
  - **Harness** — which coding agent to use (currently just "Claude Code")
  - **Model** — which model the harness runs on (Sonnet 4 default, Opus 4, Haiku 4)

  The selected harness and model are appended to the form submission payload.

- **`app/api/evolve/route.ts`**: Reads `harness` and `model` fields from the multipart form data and attaches them to the `LocalSession` object passed to `startLocalEvolve`.

- **`lib/evolve-sessions.ts`**: Added optional `harness` and `model` fields to the `LocalSession` interface and `WorkerConfig`. Both `startLocalEvolve` and `runFollowupInWorktree` now forward the session's `model` to the spawned worker process.

- **`scripts/claude-worker.ts`**: Reads the optional `model` field from its config file and passes it as `options.model` to the `query()` call, letting the SDK use the caller-specified model instead of the harness default.

## Why

The system previously had only one hardwired path: Claude Code using its built-in default model. This change lays the structural groundwork to support additional harnesses and gives users (with a non-coder-friendly UI) the ability to choose the model used for a session — useful for trading off capability vs. speed vs. cost.
