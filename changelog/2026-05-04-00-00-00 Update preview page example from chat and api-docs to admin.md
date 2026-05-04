# Update preview page example from `/chat` and `/api-docs` to `/admin`

## What changed

In `lib/evolve-sessions.ts`, the example page path used in the "mention the most relevant preview page" instruction was updated in both prompts:

- **Initial evolve prompt** (line ~703): changed example from `/api-docs` → `/admin`
- **Follow-up prompt** (line ~850): changed example from `/chat` → `/admin`

## Why

`/chat` no longer exists in the app, so using it as an example in the agent prompt was misleading. `/api-docs` exists but `/admin` is a better, more universally present example that any instance will have. Using the same example in both prompts also keeps them consistent.
