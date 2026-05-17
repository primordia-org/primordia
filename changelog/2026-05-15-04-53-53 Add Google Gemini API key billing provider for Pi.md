# Add Google Gemini API key billing provider for Pi

## What changed

Added `gemini-api-key` as a new billing source, enabling users to run Pi sessions with their own Google Gemini API key and call Gemini models directly (not through OpenRouter).

### Files modified

- **`lib/presets.ts`** — Added `'gemini-api-key'` to `SECRET_AUTH_SOURCES`, label `'Google Gemini API key'` to `PRESET_AUTH_SOURCE_LABELS`, and a built-in preset `'builtin:pi-gemini-flash'` (Pi + Gemini 2.5 Flash).
- **`lib/preset-options.ts`** — Added `isGeminiModel()` helper (`id.startsWith('gemini-')`); wired `'gemini-api-key'` to the Pi harness in `getHarnessesForAuthSource()`; added Gemini filter in `filterModelsForAuthSource()`.
- **`lib/models.generated.json`** — Added four direct Gemini models to the `pi` section: `gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-3.1-pro-preview`, `gemini-2.0-flash`.
- **`scripts/pi-worker.ts`** — Extended `normalizeModelSelection()` to detect `gemini-*` model IDs and return provider `'google'`; added a guard that refuses to fall back to the exe.dev gateway when `gemini-api-key` is the required auth source.
- **`app/api/evolve/route.ts`** — Added `'google'` to `SlugModelProvider`; extended `normalizeSlugModelSelection()` to handle `gemini-*` models; added `'gemini-api-key'` to the auth-source credential-clearing block.
- **`app/api/evolve/followup/route.ts`** and **`app/api/evolve/manage/route.ts`** — Treat `gemini-api-key` as an API-key auth source for follow-up and accept-time agent passes, so only the Gemini key is forwarded and unrelated credential fields are cleared.
- **`lib/evolve-sessions.ts`** — Added explicit Gemini auth validation before spawning workers: Gemini API key presets must use the Pi harness, a `gemini-*` model, and a provided key. Missing or incompatible Gemini credentials now surface as a direct session error instead of silently falling back to the gateway.
- **`app/evolve/session/[id]/EvolveSessionView.tsx`** — Updated the legacy session credential heuristic so `gemini-*` model runs with generic API-key auth display as Google Gemini rather than Anthropic.
- **`lib/preset-credentials-client.ts`** — Added `'gemini-api-key'` case that encrypts and transmits the Gemini key via `encryptSecretForTransmission`.
- **`lib/api-key-client.ts`** — Added `setStoredGeminiApiKey()` and `encryptStoredGeminiApiKey()` helpers.
- **`app/settings/BillingSourcesSettingsClient.tsx`** — Added `'gemini-api-key'` to the billing source type, `SOURCE_OPTIONS` list, `SourceContent` renderer, and `initialAdded` detection.
- **`app/settings/ApiKeySettingsClient.tsx`** — Added `'gemini'` as a provider type; added full key save/clear/reveal UI for Gemini with blue accent colors and `AIzaSy…` placeholder and prefix validation; "Get a key" links to `aistudio.google.com/apikey`.
- **`components/AgentIdentity.tsx`** — Added `'gemini-api-key'` → `/brand-icons/google-gemini-icon.png` in `AUTH_SOURCE_ICON_PATH`.
- **`components/MarkdownContent.tsx`** — Removed a synchronous state update from the attachment-image origin handling so the repo lint check passes under the current React hook rules.

## Why

Users who want to use Gemini models (2.5 Flash, 2.5 Pro, etc.) with the Pi coding agent previously had to go through OpenRouter (with an OpenRouter API key and the `google/gemini-*` model ID format). This adds a first-class direct-Gemini path: obtain an API key from Google AI Studio, paste it in Settings → Billing sources → Google Gemini API key, and select one of the Gemini presets from the Evolve form.

The Pi SDK already supports the `'google'` provider natively and calls `https://generativelanguage.googleapis.com/v1beta` directly — no gateway required.
