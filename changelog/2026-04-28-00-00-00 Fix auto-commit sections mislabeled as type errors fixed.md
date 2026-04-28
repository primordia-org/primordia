# Fix: Auto-commit sections mislabeled as "Type errors fixed"

## What changed

When the accept pipeline detected uncommitted/unstaged changes (Gate 2), it triggered an automated follow-up agent session to commit them. This session was being rendered in the UI as **"🔧 Type errors fixed"** — the label intended for the TypeScript auto-fix flow — because both paths shared the `skipChangelog: true` flag, which unconditionally emitted a `type_fix` section event.

### Changes made

- **`lib/session-events.ts`**: Added `'auto_commit'` as a new `sectionType` value. Updated `inferStatusFromEvents` to map `auto_commit` → `'running-claude'` (not `'fixing-types'`).

- **`lib/evolve-sessions.ts`**: Replaced the `skipChangelog: boolean` + `isAutoCommit: boolean` pair in `runFollowupInWorktree` with a single optional `internalSectionType?: 'type_fix' | 'auto_commit'` parameter. When set, the function suppresses the changelog instruction in the prompt and emits a `section_start` with that section type (labels are derived from a local map). This is more extensible — new internal pass types only need a new union member and a label entry.

- **`app/api/evolve/manage/route.ts`**: Removed the duplicate `section_start`/`followup_request` events that were prepended before the `runFollowupInWorktree` call (they were being overwritten by the function's own section event anyway). The type-fix call now passes `internalSectionType: 'type_fix'`; the auto-commit call passes `internalSectionType: 'auto_commit'`.

- **`app/evolve/session/[id]/EvolveSessionView.tsx`**: Added `'auto_commit'` to the `SectionGroup` type. Updated `RunningAgentSection` and `DoneAgentSection` to accept `isAutoCommitSection: boolean` and render with distinct green styling and correct labels:
  - Running: shows the section label as-is (`'📦 Committing unstaged changes…'`)
  - Done (success): `'📦 Unstaged changes committed'`
  - Done (error): `'❌ Auto-commit failed'`

## Why

The `type_fix` section type was being reused for a completely unrelated operation (committing unstaged changes). Users saw "🔧 Type errors fixed" in the session log when no type errors existed, which was confusing and incorrect. The new `auto_commit` section type gives this flow its own identity, correct status inference, and appropriate UI labels.
