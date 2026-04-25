# Reject localhost and HTTP canonical URLs

## What changed

The validation logic lives in a single shared utility (`lib/validate-canonical-url.ts`) used by all three enforcement points, so the rules are defined exactly once:

- **`lib/validate-canonical-url.ts`** *(new)* — exports `validateCanonicalUrl(url)` (returns an error string or `null`). Rejects empty-but-non-blank URLs, non-`https:` protocols, and localhost variants (`localhost`, `127.0.0.1`, `::1`, `*.localhost`).

- **`lib/auto-canonical.ts`** — the auto-detection logic that runs on the first incoming request now delegates to `validateCanonicalUrl(origin) !== null` to decide whether to skip. If the origin fails, it logs a skip message and resets the `checked` flag so it will try again on the next request (e.g. the first real public HTTPS request).

- **`app/api/instance/config/route.ts`** — the `PATCH` handler delegates to `validateCanonicalUrl()` and returns the error string as a `400` response body.

- **`app/admin/instance/InstanceConfigClient.tsx`** — the admin UI imports `validateCanonicalUrl()` from the same utility and runs it on every keystroke and on Save. If the value fails, the input border turns red, an inline error message is shown, and the Save request is blocked.

## Why

The installer script hits the reverse proxy as part of the setup flow. That first request originates from `http://localhost:8000`, which was being auto-detected and persisted as the canonical URL. This produces a broken `.well-known/primordia.json` and prevents the instance from ever being discovered by a parent. The fix ensures only real public HTTPS URLs can be stored.
