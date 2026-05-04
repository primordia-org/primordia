# Add OpenAI model support to pi harness via LLM gateway

## What changed

### Dynamic model list (new)

Model options are no longer hard-coded. They are generated at runtime from the
pi `ModelRegistry`, so they stay current whenever the pi SDK is updated without
any code changes.

- **`lib/pi-model-registry.server.ts`** (new, server-only): calls
  `ModelRegistry.getAll()` and returns per-harness `ModelOption[]` lists.
  - `claude-code` harness: filtered `anthropic` models (see filtering rules below)
  - `pi` harness: filtered `anthropic` + `openai` models (Anthropic first,
    then OpenAI, alphabetically within each group)
  - Four filtering rules applied to reduce ~60 registry entries down to ~10
    curated choices (see **Filtering rules** section below)
  - Also exports `getModelLabel(harness, modelId)` and
    `resolveValidModel(harness, modelId, fallback)` helpers for server-side label
    lookup and preference validation.

- **`app/api/evolve/models/route.ts`** (new): `GET /api/evolve/models` — serves
  the dynamic model list as JSON, with a 60-second client-side cache header.

- **`components/EvolveRequestForm.tsx`**: fetches the model list from
  `/api/evolve/models` on mount and uses it to populate the harness/model
  dropdowns. Silently falls back to an empty list until the fetch completes.

- **`app/evolve/session/[id]/EvolveSessionView.tsx`**: same dynamic fetch for the
  follow-up form's model picker.

- **`lib/user-prefs.ts`**: model preference validation now uses
  `resolveValidModel()` (registry-backed) instead of the static list.

- **`lib/evolve-sessions.ts`**: model label lookup for session log headers now
  uses `getModelLabel()` (registry-backed) instead of the static list.

- **`lib/agent-config.ts`**: `MODEL_OPTIONS_BY_HARNESS` removed. Only
  `HARNESS_OPTIONS`, `DEFAULT_HARNESS`, and `DEFAULT_MODEL` remain.

### OpenAI gateway support (pi harness)

- **`scripts/pi-worker.ts`**:
  - Added `OPENAI_GATEWAY_BASE_URL` (`http://169.254.169.254/gateway/llm/openai`)
  - Added `inferProvider(modelId)` helper — returns `'openai'` for `gpt-*` /
    `o<digit>*` model IDs, `'anthropic'` otherwise
  - Gateway mode: registers both `anthropic` and `openai` providers via the
    exe.dev LLM gateway
  - User API key mode: routes the supplied key to the inferred provider instead
    of hard-coding `'anthropic'`
  - Model lookup uses `modelRegistry.find(modelProvider, modelId)` rather than
    always looking in the anthropic namespace

### Filtering rules (`filterToLatestVersions` in `lib/pi-model-registry.server.ts`)

Four general rules reduce the raw ~60-model registry down to ~10 curated choices
without hard-coding any specific model names or version numbers:

| Rule | What it drops | Examples dropped |
|------|--------------|------------------|
| **R1** Drop `(latest)` or `(YYYY…` in name | Floating aliases and dated snapshots | `Claude Haiku 4.5 (latest)`, `GPT-4o (2024-11-20)` |
| **R2** Drop names containing `Chat`, `research`, `Turbo`, `Spark`, or `Max` | Specialised / old-brand variants | `GPT-4 Turbo`, `GPT-5 Chat Latest`, `o3-deep-research`, `GPT-5.1 Codex Max` |
| **R3** Drop names ending with `nano`, `pro`, or `-pro` | Oversized or over-specialised tiers (mini is kept) | `GPT-5.4 nano`, `GPT-5.4 Pro`, `o3-pro` |
| **R4** Per (provider, family), keep only highest version | Older generations in the same family | GPT-4 / GPT-4.1 / GPT-4o / … / GPT-5.4 → keep GPT-5.4; o1 / o3 → keep o3; o3-mini / o4-mini → keep o4-mini |

R4 family key = model name lowercased, `v\d+` tokens stripped, then version
number (including trailing letter, e.g. `4o` → extracts `4`) removed.
This means `GPT-4o` and `GPT-4.1` map to the same `gpt` family and are
compared numerically — 4 < 5.4, so GPT-5.4 wins.

**Current output** (as of this change):

```
claude-code harness (3 models):
  Claude Haiku 4.5 · Claude Opus 4.6 · Claude Sonnet 4.6

pi harness (10 models):
  Claude Haiku 4.5 · Claude Opus 4.6 · Claude Sonnet 4.6
  Codex Mini · GPT-5.1 Codex mini · GPT-5.3 Codex
  GPT-5.4 · GPT-5.4 mini · o3 · o4-mini
```

## Why

The previous implementation hard-coded three model IDs per harness. This meant
the list became stale as the pi SDK added new models, required manual PRs to
update, and missed the newer Anthropic and OpenAI models entirely. The new
approach reads live from `ModelRegistry.getAll()` at request time, so the
dropdown always reflects what the pi SDK actually supports without any code
changes.
