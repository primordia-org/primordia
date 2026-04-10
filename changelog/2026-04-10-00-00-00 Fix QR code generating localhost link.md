# Fix QR code generating localhost link

## What changed

`app/api/auth/cross-device/qr/route.ts` now uses a `getPublicOrigin()` helper (matching the pattern already used in `app/api/auth/exe-dev/route.ts`) to build the approval URL encoded in the QR code.

Before this fix, the URL was derived from `request.nextUrl.origin`, which returns `http://localhost:<port>` when the app runs behind a reverse proxy (e.g. exe.dev). That localhost URL is unreachable from the phone scanning the QR code.

`getPublicOrigin()` checks `X-Forwarded-Proto` and `X-Forwarded-Host` headers first, falling back to the `Host` header, and finally to the raw Next.js URL fields. This produces the correct public-facing URL regardless of how the app is deployed.

## Why

Cross-device login requires the approving device (typically a phone) to open the approval URL. A `localhost` URL is only reachable on the server itself, so the QR code was effectively broken in any reverse-proxied deployment.
