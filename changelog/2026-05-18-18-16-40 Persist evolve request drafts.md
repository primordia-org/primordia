# Persist evolve request drafts

Draft text in evolve request forms is now saved to `localStorage` while users type so refreshes no longer discard in-progress prompts. The persistence logic lives in a reusable hook that stores each draft with an `updatedAt` timestamp.

- The dedicated `/evolve` page and floating "Propose a change" dialog share the same initial-request draft, making the draft available from either entry point.
- Follow-up forms on session pages use per-session draft keys, so feedback for one session does not leak into another.
- Drafts are cleared automatically after a successful submission.
- Draft storage garbage-collects Primordia evolve drafts older than one year.

This prevents accidental data loss when a page refreshes, navigates away, or reloads during a long prompt-writing session.
