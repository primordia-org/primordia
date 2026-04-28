# Consolidate Web Preview and Preview Server sections

## What changed

On the evolve session page, the previously separate "Web Preview" iframe block and
"Preview server" card have been merged into a single card — and then further simplified
by removing all redundant chrome.

**Before:**
- A standalone `xl:hidden` `<WebPreviewPanel>` block appeared in the progress list (visible
  on mobile only, only when the server was running).
- Below it, a dedicated "🚀 Preview server" card showed the URL, a text status label, a
  restart button, and collapsible server logs — always visible when the session was ready,
  even on desktop where the iframe already lived in the sidebar.

**After:**
- A single card replaces both, with no top title row.
- The iframe is embedded directly in the card body at all screen sizes, with inline
  "Starting preview…" and "Preview server stopped" states when the server isn't running.
- A collapsible "🪵 Server logs" section sits at the bottom of the card
  (auto-expanded when the server is stopped). The restart/start button lives in the
  `<summary>` row, to the right of the "Server logs" label, so it doesn't open/close logs.
- On **desktop** (`xl`+), when a preview URL is available the entire card (iframe + logs)
  moves into the right-hand sidebar — replacing the previous split where the iframe lived
  in the aside but the server logs stayed in the main column. The main column card is
  hidden on desktop in this case (`xl:hidden`).

## Why

The two sections were redundant — the URL appeared in "Preview server" but was already
the source of the iframe in "Web preview". The server status was shown as an explicit text
label, but is implied by whether the iframe is loading. The title row added no information
beyond what the iframe itself communicates. Keeping iframe and server logs together as one
logical unit (even on desktop) is cleaner than splitting them across the main column and
the sidebar.
