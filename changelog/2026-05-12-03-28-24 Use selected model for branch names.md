# Use selected model for branch names

Evolve session branch-name generation now asks the model selected for the evolve request instead of always using Claude Haiku. This avoids session creation depending on Haiku availability when the user has chosen a different available model.

Slug generation now uses the selected auth source class for Anthropic, OpenAI, OpenRouter, ChatGPT subscription/OpenAI Codex, and exe.dev gateway-backed requests where possible, falling back to a deterministic local slug if the lightweight model call cannot be completed.

The evolve pipeline documentation was updated to describe the selected-model slug generation behavior.
