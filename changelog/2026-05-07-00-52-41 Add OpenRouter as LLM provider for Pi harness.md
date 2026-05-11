# Add OpenRouter as LLM provider for Pi harness

## What changed

The Pi coding agent harness now supports OpenRouter as a third LLM provider, alongside the existing Anthropic and OpenAI (via exe.dev gateway) options.

- **`lib/pi-model-registry.server.ts`** — Added `openrouter` to `HARNESS_PROVIDERS['pi']`, added `OpenRouter` to `PROVIDER_LABELS`, set a placeholder auth key so the pi SDK includes OpenRouter models in its listing, and added two new filter rules:
  - **R5**: Drop model IDs containing `:` (OpenRouter variant suffix tags like `:free`, `:extended`, `:thinking`).
  - **R6**: Drop meta-router / auto-router model IDs (`auto`, `openrouter/*`).

- **`scripts/regenerate-model-registry.ts`** — Mirrored the same changes (providers, labels, auth placeholder, R5/R6 filters) so the generated model list stays in sync.

- **`scripts/pi-worker.ts`** — Updated `inferProvider()` to return `'openrouter'` for model IDs containing `/` (the standard OpenRouter format: `{sub-provider}/{model-id}`, e.g. `google/gemini-2.5-flash`). Direct OpenAI and Anthropic model IDs are recognised first by their well-known prefixes (`gpt-`, `o\d`, `codex-`, `claude-`).

- **`lib/models.generated.json`** — Regenerated. The Pi harness now lists 157 models: 3 Anthropic, 7 OpenAI (direct), and 147 OpenRouter.

- **`app/settings/ApiKeySettingsClient.tsx`** — Added a fully functional OpenRouter API key card (violet theme, `sk-or-` prefix validation, save/clear/active-badge). Sits between the Anthropic card and the "Coming soon" providers. Updated the priority breadcrumb to note it applies to Claude models.

- **`lib/api-key-client.ts`** — Added `hasStoredOpenRouterApiKey`, `setStoredOpenRouterApiKey`, and `encryptStoredOpenRouterApiKey` — parallel helpers that use a separate localStorage slot (`primordia_openrouter_aes_key`) and a separate server endpoint (`/api/llm-key/encrypted-openrouter-key`).

- **`app/api/llm-key/encrypted-openrouter-key/route.ts`** — New route (GET/POST/DELETE) mirroring `encrypted-key/route.ts` with preference key `encrypted_openrouter_api_key`.

- **`components/EvolveRequestForm.tsx`** — When submitting with a Pi harness and an OpenRouter model (ID contains `/`), the encrypted OpenRouter key is sent instead of the Anthropic key.

- **`app/evolve/session/[id]/EvolveSessionView.tsx`** — Same key-routing logic for follow-up submissions and the accept flow.

- **`components/SettingsSubNav.tsx`** — The "API Keys" tab shows the active indicator when either the Anthropic or OpenRouter key is set.

- **`lib/secrets-client.ts`** *(new)* — Unified client-side secret storage. Replaces the per-secret-type AES key design with a single shared `primordia_aes_key` in localStorage, making cross-device key sync trivial. Defines `SecretType = 'ANTHROPIC_API_KEY' | 'OPENROUTER_API_KEY' | 'OPENAI_API_KEY' | 'GEMINI_API_KEY' | 'CLAUDE_CODE_CREDENTIALS_JSON'` and exports `hasSecret`, `setSecret`, `clearSecret`, `updateSecret`, `encryptSecretForTransmission` (RSA-OAEP for API keys), and `encryptCredentialsForTransmission` (hybrid encryption for large credentials). A `primordia_secrets` index in localStorage enables synchronous `hasSecret()` checks without a round-trip.

- **`app/api/secrets/[type]/route.ts`** *(new)* — Unified GET/POST/DELETE route replacing the per-type `llm-key/encrypted-*` routes. The `[type]` segment is validated against the known `SecretType` values and mapped to backward-compatible `user_preferences` keys.

- **`lib/api-key-client.ts`** — Converted to a compatibility shim; all functions now delegate to `secrets-client.ts`.

- **`lib/credentials-client.ts`** — Converted to a compatibility shim; all functions now delegate to `secrets-client.ts`.

- **`app/settings/claude-ai/CredentialsSettingsClient.tsx`** — Updated orphaned-key check to fetch from `/api/secrets/CLAUDE_CODE_CREDENTIALS_JSON` instead of the legacy route.

## How to use

1. Go to **Account Settings → API Keys** (hamburger menu → Account Settings).
2. Enter your OpenRouter API key (`sk-or-…`) in the **OpenRouter** card and click **Save key**. Get a key at [openrouter.ai/keys](https://openrouter.ai/keys).
3. Open the evolve form, expand **Advanced**, select the **Pi** harness, and pick any model whose ID contains `/` (e.g. `google/gemini-2.5-flash`, `deepseek/deepseek-r1`, `meta-llama/llama-4-maverick`).
4. The OpenRouter key is automatically used for OpenRouter models; the Anthropic key continues to be used for direct Anthropic/OpenAI models.

## Why

The pi SDK already supports OpenRouter natively (253 built-in models, base URL `https://openrouter.ai/api/v1`, `openai-completions` API format). No additional SDK changes were needed — just wiring up the provider in Primordia's model registry and provider-inference logic. This gives Pi users access to Google Gemini, Meta Llama, DeepSeek, Mistral Devstral/Codestral, Qwen Coder, xAI Grok, and many other models not available through the direct Anthropic/OpenAI gateways.
