# Reject localhost and HTTP canonical URLs

## What changed

Three layers of protection now prevent `localhost` or plain-`http://` from ever being saved as the Canonical URL:

1. **`lib/auto-canonical.ts`** — the auto-detection logic that runs on the first incoming request now checks the derived origin before persisting it. If the origin is `http://` (any) or any variant of `localhost` (`localhost`, `127.0.0.1`, `::1`, `*.localhost`), it logs a skip message and resets the `checked` flag so it will try again on the next request (e.g. the first real public HTTPS request).

2. **`app/api/instance/config/route.ts`** — the `PATCH` handler validates `canonicalUrl` more strictly: it parses the URL, rejects anything that isn't `https:`, and rejects any hostname that resolves to localhost. Returns a descriptive `400` error in each case.

3. **`app/admin/instance/InstanceConfigClient.tsx`** — the admin UI now validates the Canonical URL field client-side on every keystroke and on Save. If the value is non-empty and fails the same rules (not HTTPS, or is localhost), the input border turns red and an inline error message is shown. The Save request is blocked until the value is valid.

## Why

The installer script hits the reverse proxy as part of the setup flow. That first request originates from `http://localhost:8000`, which was being auto-detected and persisted as the canonical URL. This produces a broken `.well-known/primordia.json` and prevents the instance from ever being discovered by a parent. The fix ensures only real public HTTPS URLs can be stored.
