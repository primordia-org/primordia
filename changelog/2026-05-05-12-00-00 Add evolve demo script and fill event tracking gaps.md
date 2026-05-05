# Add evolve demo script and fill event tracking gaps

## What changed

### Demo script (`docs/evolve-demo-script.md`)
Created a 36-step instructional video script for the evolve feature, organized into 6 acts (open form → attachments & options → submit & watch → review preview → diffs & follow-up → accept/reject). Each step is annotated with the exact `trackEvent` call that fires. A gap analysis at the end confirms event coverage is sufficient to reconstruct the demo from events alone.

### New events added

Filled gaps identified by the demo script analysis:

**Session lifecycle** (`EvolveSessionView.tsx`):
- `session/page-viewed/v1` — fires on mount with sessionId + initial status
- `session/status-changed/v1` — fires on every status transition (from/to)
- `session/preview-loaded/v1` — fires when previewUrl first becomes non-null
- `session/followup-submitted/v1` — distinct from initial submit, includes harness/model/element context
- `session/preview-element-selected/v1` — element picked from preview panel inspector
- `session/diff-summary-toggled/v1` — Files Changed section open/close

**Preview panel** (`WebPreviewPanel.tsx`):
- `preview/back-clicked/v1`, `preview/forward-clicked/v1`, `preview/refresh-clicked/v1`
- `preview/url-navigated/v1` — URL bar form submit
- `preview/open-in-new-tab/v1` — external link click
- `preview/inspector-toggled/v1` — crosshair inspector on/off

**Diff viewer** (`DiffFileExpander.tsx`):
- `session/diff-file-toggled/v1` — individual file expand/collapse with filename

### Plumbing
- Threaded `sessionId` prop through `WebPreviewCard` → `WebPreviewPanel` so preview events can include session context.

## Why

Event coverage was ~60% of the evolve workflow — major phases (preview interaction, diff review, status transitions, follow-up) were invisible. These gaps made it impossible to reconstruct a demo video from event logs alone. After this change, every major user action in the evolve flow emits a tracked event.
