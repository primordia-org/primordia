# Add inline ChatGPT relogin prompt

Evolve session agent failures caused by expired or missing ChatGPT subscription credentials now render a focused inline re-login panel instead of exposing confusing raw Pi/Codex authentication logs.

The session view recognizes both Pi/Codex ChatGPT token-expiration or sign-in-again errors, explains that ChatGPT needs to be reconnected, and lets the user restart the ChatGPT device-code login flow directly from the failed agent section. It still recognizes older Pi `No API key for provider: openai-codex` session logs for backward compatibility.

Pi ChatGPT subscription runs now preflight the OAuth token with fallback disabled before starting the agent. When token refresh fails, Primordia emits a direct ChatGPT session-expired error instead of letting Pi continue until the lower-level provider reports a generic missing API key.

The inline prompt now shares the same ChatGPT subscription auth card implementation used by the Billing sources settings page, keeping device-code login behavior, styling, event tracking, and secret storage consistent across both surfaces.
