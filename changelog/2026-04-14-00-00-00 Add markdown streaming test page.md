# Add Markdown Streaming Test Page

## What changed

- **`app/api/markdown-stream/route.ts`** — new SSE API route that streams a comprehensive markdown document character-by-character (or in configurable chunks). Accepts `delay` (ms per tick, 0–200) and `chunk` (chars per event, 1–50) query params.

- **`app/markdown-test/page.tsx`** — new client-side test page at `/markdown-test` that:
  - Connects to the SSE stream on mount and accumulates received text
  - Renders accumulated text with `<MarkdownContent>` — the same component and styling used on the evolve session page — so the test is visually representative of the real app
  - The card wrapper mirrors the `RunningClaudeSection` layout from `EvolveSessionView` (rounded-lg, `bg-gray-900`, `border-blue-700/50` while streaming, header with pulsing dot)
  - Shows a status bar (streaming / done / error) and live character count
  - Exposes controls for speed (delay slider), chunk size (select), and a Start / Stop / Restart button
  - Starts streaming automatically on page load

## Why

The branch is specifically for testing the streamdown component migration. Having a dedicated page that exercises all major Markdown syntax — headings H1–H6, emphasis, blockquotes, ordered/unordered/task lists, fenced code blocks in multiple languages, GFM tables, horizontal rules, inline HTML, and long paragraphs — makes it easy to spot rendering regressions as streamdown is updated.
