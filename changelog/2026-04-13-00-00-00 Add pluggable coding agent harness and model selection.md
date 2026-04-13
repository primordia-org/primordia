# Add pluggable coding agent harness and model selection

## What changed

- **`lib/agent-config.ts`** (new): Central registry of supported coding agent harnesses and the models each harness offers. Currently defines one harness (`claude-code`) with three model options (Sonnet 4 default, Opus 4, Haiku 4). Adding future harnesses only requires extending this file.

- **`components/EvolveRequestForm.tsx`** (new): Shared form component used by the `/evolve` page, the floating dialog, **and the follow-up panel** on session detail pages. Accepts optional props (`onSubmit`, `placeholder`, `submitLabel`, `disabled`, `disabledLabel`, `autoFocus`) so callers can customise behaviour without duplicating markup. Contains the textarea, file attachments (drag-and-drop / paste / picker), submit button, and a collapsible **"Advanced"** section (gear icon toggle) with two dropdowns:
  - **Harness** — which coding agent to use (currently just "Claude Code")
  - **Model** — which model the harness runs on (Sonnet 4 default, Opus 4, Haiku 4)

  The paperclip icon in the Attach button is now a Lucide-style stroke SVG, matching the icon set used in the navbar menu (previously a Heroicons fill SVG). A `compact` prop adjusts sizing for the floating dialog. Harness and model option labels are shown without descriptions to keep the UI terse. The outer border and background have been removed from the form element itself — parent containers are now responsible for borders, eliminating double-border issues in the floating dialog and follow-up panel. The textarea uses a visible `bg-gray-800` background with a `border-gray-700` border and amber focus ring for clear delineation.

- **`components/EvolveSessionView.tsx`**: The follow-up changes panel now uses `EvolveRequestForm` directly, eliminating the previously duplicated inline form. All followup-specific state, refs, and event handlers have been removed from this component. The `onSubmit` callback posts to `/api/evolve/followup` and triggers status/streaming updates on success.

- **`app/api/evolve/followup/route.ts`**: Now reads optional `harness` and `model` fields from the multipart form data and attaches them to the `LocalSession` object, so the follow-up worker runs with the user's chosen agent configuration.

- **`components/EvolveForm.tsx`**: Simplified to just the page chrome (header, nav, description banner); the form itself is now `<EvolveRequestForm />` wrapped in a `border border-gray-800 rounded-xl bg-gray-900` container (since the page has no outer container of its own).

- **`components/FloatingEvolveDialog.tsx`**: Simplified to just the floating dialog chrome (title bar, dock buttons, resize handle); the form is now `<EvolveRequestForm compact />`.

- **`app/api/evolve/route.ts`**: Reads `harness` and `model` fields from the multipart form data and attaches them to the `LocalSession` object passed to `startLocalEvolve`.

- **`lib/evolve-sessions.ts`**: Added optional `harness` and `model` fields to the `LocalSession` interface and `WorkerConfig`. Both `startLocalEvolve` and `runFollowupInWorktree` now forward the session's `model` to the spawned worker process.

- **`scripts/claude-worker.ts`**: Reads the optional `model` field from its config file and passes it as `options.model` to the `query()` call, letting the SDK use the caller-specified model instead of the harness default.

- **`lib/session-events.ts`**: Added a new `sectionType: 'agent'` variant for `section_start` events. Unlike the legacy `'claude'` type, agent sections carry explicit `harness` and `model` fields (human-readable labels, e.g. `"Claude Code"` and `"Claude Sonnet 4"`) alongside the pre-built `label` string (e.g. `"🤖 Claude Code (Claude Sonnet 4)"`). The legacy `'claude'` variant is retained for backward-compatibility with existing session logs. `inferStatusFromEvents` now treats `'agent'` sections identically to `'claude'` (→ `running-claude`).

- **`lib/evolve-sessions.ts`**: The two places that previously wrote `{ sectionType: 'claude', label: '🤖 Claude Code' }` now write `{ sectionType: 'agent', harness: <label>, model: <label>, label: '🤖 <harness> (<model>)' }` using the human-readable labels from `agent-config.ts`. This applies to both the initial run and follow-up runs.

- **`components/EvolveSessionView.tsx`**: `SectionGroup` now carries optional `harness` and `model` string fields populated from `agent` section events by `groupEventsIntoSections`. `RunningClaudeSection` and `DoneClaudeSection` use these directly to render context-aware titles:
  - Running: `🤖 Claude Code (Claude Sonnet 4) running…`
  - Finished: `🤖 Claude Code (Claude Sonnet 4) finished`
  - Errored: `❌ Claude Code (Claude Sonnet 4) errored`

  Legacy `'claude'` sections fall back to `"Claude Code"` as the agent label.

## Why

The system previously had only one hardwired path: Claude Code using its built-in default model. This change lays the structural groundwork to support additional harnesses and gives users (with a non-coder-friendly UI) the ability to choose the model used for a session — useful for trading off capability vs. speed vs. cost.

The session view now shows which harness and model were actually used, so users can correlate session outcomes with their configuration choices. Harness/model are stored directly in the `section_start` event (the natural source of truth for a section's identity) rather than redundantly on a separate `initial_request` event.
