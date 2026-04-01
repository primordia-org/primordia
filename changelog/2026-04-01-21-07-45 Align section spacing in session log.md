# Align section spacing in session log

## What changed

- Increased the vertical gap between progress sections in the evolve session log from `gap-2` (8px) to `gap-6` (24px), matching the `mb-6` spacing used around the "Created branch" card.
- Moved the "✅ Changes accepted" and "🗑️ Changes rejected" banners inside the progress sections flex container so they appear in-line with the rest of the session log, rather than being pushed to the bottom of the page by `flex-1` on the container.
- Removed `flex-1` from the progress sections container, which was causing the accepted/rejected banners to render far below the log content when the session reached a terminal state.

- Fixed `splitClaudeContent` in `EvolveSessionView.tsx`: the "final message" shown outside the `<details>` in a finished Claude Code section now captures everything between the last `- 🔧 ` tool call line and the `✅ Claude Code finished.` marker, rather than taking only the last double-newline-separated paragraph. This means multi-paragraph closing messages from Claude are shown in full.

- Fixed `parseProgressSections` in `EvolveSessionView.tsx`: the section-boundary regex now only splits on `### ` headings followed by a non-ASCII (emoji) character, so markdown headings that Claude writes in its summary (e.g. `### Changes made`) are no longer broken out as their own top-level sections.

- Fixed `LogSection` in `EvolveSessionView.tsx`: a Claude Code section now detects the end-of-section markers (`✅ **Claude Code finished.**` and `✅ **Follow-up complete. Preview server will reload automatically.**`) directly in the content and switches to the "finished" title immediately, rather than waiting for the `status`/`devServerStatus` fields to arrive in the same SSE tick. The "Follow-up complete" message itself is not rendered — it is only used as the signal.

## Why

The "Claude Code finished" and "🚀 Preview ready" cards had only 8px of breathing room between them (Tailwind `gap-2`), while the "Created branch" card had 24px (`mb-6`) below it. The inconsistency made the log feel cramped mid-way through. Unifying to `gap-6` gives each section room to read clearly.

The accepted/rejected banners were positioned after the `flex-1` container, which in a `min-h-dvh` flex-column layout caused them to float at the very bottom of the viewport rather than immediately following the last progress section. Moving them inside the sections container (and removing `flex-1`) keeps them in the natural document flow.

The previous `splitClaudeContent` paragraph-split approach could truncate Claude's closing message when it spanned multiple paragraphs. Splitting at the last tool call line instead is exact: every line after the last `- 🔧 ` entry is Claude's final response.

Claude Code sometimes uses markdown headings like `### Changes made` in its closing summary. Because all real section delimiters use emoji-prefixed headings (e.g. `### 🤖 Claude Code`), restricting the split regex to non-ASCII leading characters cleanly distinguishes them.

The "Running…" badge on a follow-up Claude Code section could persist briefly even after the follow-up completed, because the SSE stream delivers progress text and status in the same payload but the component only checked the `status` prop. Detecting the end marker in the content directly closes that window and also avoids rendering the noisy "Follow-up complete. Preview server will reload automatically." message in the UI.
