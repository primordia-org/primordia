# Add OpenAI model support to pi harness via LLM gateway

## What changed

- **`lib/agent-config.ts`**: Added three OpenAI models to the pi harness model picker:
  - `gpt-4.1` — GPT-4.1, balanced
  - `o4-mini` — OpenAI fast reasoning model
  - `o3` — OpenAI powerful reasoning model

- **`scripts/pi-worker.ts`**:
  - Added `OPENAI_GATEWAY_BASE_URL` constant (`http://169.254.169.254/gateway/llm/openai`)
  - Added `inferProvider()` helper: returns `'openai'` for model IDs starting with `gpt-` or matching `/^o\d/`, `'anthropic'` otherwise
  - Gateway mode: registers both `anthropic` and `openai` providers via the exe.dev LLM gateway (sets placeholder `'gateway'` key for both so the SDK treats both as authenticated)
  - User API key mode: routes the supplied key to the inferred provider rather than hard-coding `'anthropic'`
  - Model lookup now uses the inferred provider (`modelRegistry.find(modelProvider, modelId)`) instead of always looking in the anthropic namespace

## Why

The pi coding agent harness previously only exposed Anthropic (Claude) models. The exe.dev LLM gateway already proxies OpenAI in addition to Anthropic, so adding OpenAI model support required only:
1. Exposing the OpenAI gateway URL alongside the Anthropic one
2. Routing model lookup and auth key to the correct provider based on the selected model ID
