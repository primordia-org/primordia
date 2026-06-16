# Add inline ChatGPT relogin prompt

Evolve session agent failures caused by expired or missing ChatGPT subscription credentials now render a focused inline re-login panel instead of exposing confusing raw Pi/Codex authentication logs.

The session view recognizes both Pi's `No API key for provider: openai-codex` failure and Codex token-expiration/sign-in-again errors, explains that ChatGPT needs to be reconnected, and lets the user restart the ChatGPT device-code login flow directly from the failed agent section.
