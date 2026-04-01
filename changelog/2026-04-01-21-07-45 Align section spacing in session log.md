# Align section spacing in session log

## What changed

- Increased the vertical gap between progress sections in the evolve session log from `gap-2` (8px) to `gap-6` (24px), matching the `mb-6` spacing used around the "Created branch" card.
- Moved the "✅ Changes accepted" and "🗑️ Changes rejected" banners inside the progress sections flex container so they appear in-line with the rest of the session log, rather than being pushed to the bottom of the page by `flex-1` on the container.
- Removed `flex-1` from the progress sections container, which was causing the accepted/rejected banners to render far below the log content when the session reached a terminal state.

## Why

The "Claude Code finished" and "🚀 Preview ready" cards had only 8px of breathing room between them (Tailwind `gap-2`), while the "Created branch" card had 24px (`mb-6`) below it. The inconsistency made the log feel cramped mid-way through. Unifying to `gap-6` gives each section room to read clearly.

The accepted/rejected banners were positioned after the `flex-1` container, which in a `min-h-dvh` flex-column layout caused them to float at the very bottom of the viewport rather than immediately following the last progress section. Moving them inside the sections container (and removing `flex-1`) keeps them in the natural document flow.
