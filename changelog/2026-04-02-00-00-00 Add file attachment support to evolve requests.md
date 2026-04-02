# Add file attachment support to evolve requests

## What changed

Users can now attach files and images when submitting an evolve request (initial or follow-up). Claude Code will have access to those files inside the worktree and can read, reference, or save them into the project.

### UI changes

- **`EvolveForm.tsx`** — Added an "Attach files" button below the textarea. Selected files are shown as removable chips. The form now submits as `multipart/form-data` instead of JSON when attachments are included.
- **`EvolveSessionView.tsx`** — Added the same "Attach files" button and file-chip list to both the follow-up panel (normal state) and the error-state follow-up panel. Follow-up requests now also submit as `multipart/form-data`.

### API changes

- **`app/api/evolve/route.ts`** — POST handler now accepts both `multipart/form-data` (new, with optional file uploads) and plain JSON (legacy, still supported). Uploaded files are saved to a temp dir in `/tmp` and their paths passed through to `startLocalEvolve`.
- **`app/api/evolve/followup/route.ts`** — Same dual-format support added. Attachment paths are forwarded to `runFollowupInWorktree`.

### Core library changes

- **`lib/evolve-sessions.ts`**:
  - `startLocalEvolve` accepts a new optional `attachmentPaths: string[]` parameter.
  - `runFollowupInWorktree` accepts the same optional `attachmentPaths` parameter.
  - Before running Claude, attached files are copied from the temp dir into `worktree/attachments/` and the temp files are cleaned up.
  - The Claude prompt is augmented with a list of the attached file paths so Claude knows to read and use them.
  - A progress log entry is appended when attachments are copied (e.g. "Copied 2 attachment(s) into worktree").

### Gitignore

- **`.gitignore`** — Added `/attachments/` so uploaded files copied into worktrees are never accidentally committed.

## Why

Users often want to hand Claude a screenshot, mockup image, design spec, or data file as context for a change request. Without this feature, they had to describe the files in words or find another way to get the content into the worktree. Now they can attach the files directly and Claude will have access to them. The `attachments/` directory is gitignored because these files are transient user uploads, not project source code.
