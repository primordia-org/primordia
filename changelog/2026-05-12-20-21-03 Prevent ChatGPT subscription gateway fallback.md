# Prevent ChatGPT subscription gateway fallback

Changed ChatGPT subscription evolve runs so they fail fast when the selected preset cannot provide ChatGPT OAuth credentials, instead of silently falling back to the exe.dev LLM gateway.

This affects initial evolve requests, follow-up requests, accept-time auto-commit/type-fix runs, and the Pi/Codex worker processes themselves. Workers now receive the selected auth source and refuse gateway fallback when ChatGPT subscription auth was required.
