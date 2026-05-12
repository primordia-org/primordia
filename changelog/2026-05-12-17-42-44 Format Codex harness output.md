# Format Codex harness output

Codex exec JSON events are now translated into Primordia's structured session event types instead of being flattened into markdown text.

This makes Codex runs render like the existing Claude Code and Pi harnesses:

- Command executions, file changes, MCP calls, web searches, collaboration calls, and todo updates are recorded as `tool_use` events.
- Codex reasoning summaries are recorded as `thinking` events so they use the existing collapsible reasoning display.
- Turn token usage is recorded as `metrics` so the session footer can show token counts.

The previous text-only adapter printed command starts directly, which could show unhelpful shell launcher text like `$ /bin/bash` instead of the actual structured tool activity.
