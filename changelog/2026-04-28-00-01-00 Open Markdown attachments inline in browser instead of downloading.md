# Open Markdown attachments inline in browser instead of downloading

## What changed

- **`app/api/evolve/attachment/[sessionId]/route.ts`**: Markdown (`.md`) files are now served with `Content-Disposition: inline` and `Content-Type: text/plain; charset=utf-8` so browsers display them as text in a new tab rather than triggering a file download. Also added `.csv` to the inline-text set for consistency, and added `X-Content-Type-Options: nosniff` to all attachment responses.

- **`app/evolve/session/[id]/EvolveSessionView.tsx`**: The `AttachmentChip` component now renders a small `FileText` icon for `.md` / `.markdown` files, matching the visual affordance that images get (thumbnail), so users know the file is viewable rather than just downloadable.

## Why

Markdown files are human-readable text. Clicking an attachment chip should let you read the file in the browser immediately, not download it to disk — the same way image attachments already open inline.
