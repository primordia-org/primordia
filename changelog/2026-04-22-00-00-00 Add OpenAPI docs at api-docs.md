# Add OpenAPI docs at /api-docs

## What changed

- Added `next-openapi-gen` and `@scalar/api-reference-react` to generate and serve interactive API documentation.
- New page at `/api-docs` renders a Scalar API reference UI (dark "moon" theme, modern layout).
- `openapi-gen.config.json` configures the generator: scans `./app/api`, outputs to `public/openapi.json`, targets the `scalar` UI at `api-docs`.
- `public/openapi.json` committed as the generated OpenAPI 3.0 spec (38 endpoints across Chat, Auth, Evolve, Changelog, Config groups).
- Added `@openapi` JSDoc annotations to the key public-facing routes:
  - `GET /api/auth/session` — current session
  - `POST /api/auth/logout` — log out
  - `POST /api/auth/passkey/register/start|finish` — passkey registration
  - `POST /api/auth/passkey/login/start|finish` — passkey login
  - `POST /api/chat` — stream chat from Claude
  - `GET /api/changelog` — fetch a changelog entry body
  - `GET /api/check-keys` — check missing env vars
  - `POST /api/evolve` — start an evolve session
  - `GET /api/evolve/stream` — SSE stream of session progress
  - `POST /api/evolve/manage` — accept or reject a session
  - `POST /api/evolve/followup` — submit a follow-up request
  - `GET /api/llm-key/public-key` — RSA-OAEP public key for client-side API key encryption
- Added `"API Docs"` nav link in `NavHeader` (suppressed when already on `/api-docs`).
- Added `generate-api-docs` npm script: `next-openapi-gen generate --config openapi-gen.config.json`.

## Why

Exploring how Primordia might work as a mobile app or serverless client. A browsable, mobile-friendly API reference makes it easy to understand what endpoints exist, what they expect, and what they return — without reading source code.
