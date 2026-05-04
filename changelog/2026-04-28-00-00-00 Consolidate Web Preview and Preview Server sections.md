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
- A single `WebPreviewCard` component replaces both, with no top title row.
- The card contains two parts: an iframe/placeholder area and a collapsible
  "🪵 Server logs" strip at the bottom (auto-expanded when stopped). The restart/start
  button lives in the `<summary>` row to the right of the label.
- Stopped/starting states use the same large circular play button on both mobile and
  desktop — because it is literally the same component rendered in both places.
- `WebPreviewPanel` no longer renders its own border; `WebPreviewCard` owns the single
  green border around the whole unit.
- On **desktop** (`xl`+), when a preview URL is available the `WebPreviewCard` renders
  inside the right-hand sidebar (`fullHeight=true`; `h-full flex-col` so the iframe fills
  the remaining space). The main-column copy is hidden (`xl:hidden`).
- On **mobile / tablet**, the same `WebPreviewCard` renders inline in the progress list
  (`fullHeight=false`; 600 px fixed height matching the old `WebPreviewPanel` default).

## Why

The two sections were redundant — the URL appeared in "Preview server" but was already
the source of the iframe in "Web preview". The server status was shown as an explicit text
label, but is implied by whether the iframe is loading. The title row added no information
beyond what the iframe itself communicates. Extracting a single shared component ensures
the mobile and desktop experiences are always identical, and keeps the iframe and server
logs together as one logical unit regardless of where they are rendered.
