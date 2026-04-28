# Consolidate Web Preview and Preview Server sections

## What changed

On the evolve session page, the previously separate "Web Preview" iframe block and
"Preview server" card have been merged into a single **"Web Preview"** card.

**Before:**
- A standalone `xl:hidden` `<WebPreviewPanel>` block appeared in the progress list (visible
  on mobile only, only when the server was running).
- Below it, a dedicated "🚀 Preview server" card showed the URL, a text status label, a
  restart button, and collapsible server logs — always visible when the session was ready,
  even on desktop where the iframe already lived in the sidebar.

**After:**
- A single "🚀 Web Preview" card replaces both.
- The card header contains a compact status dot (colour-coded: green/yellow/red/grey), the
  preview URL as a truncated link, and the restart/start button — all in one line.
- On mobile (`xl:hidden`), the iframe is embedded directly in the card body, with inline
  "Starting preview…" and "Preview server stopped" states when the server isn't running.
- A collapsible "🪵 Server logs" section is always present at the bottom of the card
  (auto-expanded when the server is stopped).

## Why

The two sections were redundant — the URL appeared in "Preview server" but was already
the source of the iframe in "Web preview". The server status was shown as an explicit text
label in "Preview server" but was also implied by whether the iframe was loading. Combining
them removes the duplication and makes the layout more compact, while preserving all
functionality (URL link, status indication, restart button, server logs).
