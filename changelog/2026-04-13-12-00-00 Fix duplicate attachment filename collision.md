# Fix duplicate attachment filename collision

When multiple files with the same name were attached to an evolve request (e.g., pasting two images that both get named `image.png`), the second file silently overwrote the first. Only the last file survived.

## What changed

- **Upload endpoints** (`/api/evolve` and `/api/evolve/followup`): when saving uploaded files to the temp directory, duplicate filenames now get a `_1`, `_2`, etc. suffix before the extension (e.g., `image.png` → `image_1.png`).
- **Worktree copy** (`lib/evolve-sessions.ts`): when copying attachments into the worktree's `attachments/` directory, existing filenames are checked first so follow-up uploads don't overwrite attachments from earlier requests.
- **Clipboard image naming** (`EvolveRequestForm.tsx`): images pasted from the clipboard are now named `clipboard.png`, `clipboard_2.png`, etc. instead of the browser's generic `image.png`, making it easy to tell them apart when multiple are pasted.
- **Attachment chip thumbnails** (`EvolveRequestForm.tsx`): image attachments in the request form now show a small inline thumbnail preview (matching the style already used on the session detail page), so you can visually confirm which images are attached before submitting.
