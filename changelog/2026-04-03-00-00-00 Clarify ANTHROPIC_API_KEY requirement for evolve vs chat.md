# Clarify ANTHROPIC_API_KEY requirement for evolve vs chat

## What changed

Updated `README.md` and `PRIMORDIA.md` to correctly distinguish when `ANTHROPIC_API_KEY` is and isn't required:

- **Chat interface**: works without `ANTHROPIC_API_KEY` on exe.dev — the built-in LLM gateway handles it.
- **Evolve pipeline (Claude Code)**: always requires `ANTHROPIC_API_KEY` in all environments, including exe.dev. The `@anthropic-ai/claude-agent-sdk` `query()` call does not go through the exe.dev gateway.

## Why

The README previously stated that the exe.dev built-in gateway handles "both the chat interface and the evolve pipeline", and a blockquote said "No `ANTHROPIC_API_KEY` is needed on exe.dev." This was incorrect — the evolve pipeline (Claude Code via `claude-agent-sdk`) requires a real Anthropic API key. Users setting up on exe.dev without providing `ANTHROPIC_API_KEY` would find that chat works but evolve silently fails or errors.

## Files changed

- `README.md` — corrected prerequisites, deploy section, exe.dev hosting table, blockquote, and environment variables table
- `PRIMORDIA.md` — corrected environment variables table and setup checklist note
