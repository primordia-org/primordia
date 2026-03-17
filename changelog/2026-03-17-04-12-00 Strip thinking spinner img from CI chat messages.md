# Strip thinking spinner img from CI chat messages

## What changed

Added a `stripThinkingSpinner()` helper in `app/api/evolve/status/route.ts` that removes the Claude Code "thinking" spinner `<img>` tag from GitHub comment bodies before they are returned to the chat UI.

The spinner is a 14×14 px inline image (e.g. `<img src="https://github.com/user-attachments/assets/..." width="14px" height="14px" style="vertical-align: middle; margin-left: 4px;" />`) that Claude Code appends to its GitHub comment while it is working. It is designed for GitHub's rendered markdown view, not for Primordia's plain-text chat display, where it shows up as a noisy broken-image or raw HTML string.

## Why

The spinner cluttered the CI progress display in the chat interface. Stripping it server-side (in `status/route.ts`) keeps the fix in one place and requires no changes to the frontend rendering logic.
