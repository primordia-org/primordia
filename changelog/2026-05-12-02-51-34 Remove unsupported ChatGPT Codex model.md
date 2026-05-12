# Remove unsupported ChatGPT Codex model

Removed `openai-codex:gpt-5.1-codex-mini` from the ChatGPT subscription model list because Codex rejects it when authenticated with a ChatGPT account.

Also added a generator-side blacklist and preset availability validation so future registry regeneration or previously saved custom presets do not expose unsupported ChatGPT subscription models.
