# Add x-forwarded header support to eliminate REVERSE_PROXY_PORT from URLs

## What changed

### `scripts/reverse-proxy.ts`
- **Pass through `x-forwarded-proto`** instead of hardcoding `'http'`. The reverse proxy was always overriding `x-forwarded-proto` with `'http'`, which meant the Next.js app never saw the original `https` value set by the outer exe.dev proxy. Now the value from the upstream proxy (e.g. `https`) is passed through, falling back to `'http'` if absent.
- **Set `x-forwarded-port`** on every forwarded request. Added a new `derivePublicPort()` helper that derives the correct public port from (in order of preference): the incoming `x-forwarded-port` header, the port embedded in `x-forwarded-host`, the port in the `Host` header, or the protocol default (443/80). This ensures the Next.js app always has an explicit `x-forwarded-port` available.
- **Fix `x-forwarded-proto` passthrough in WebSocket upgrades.** The `buildWsUpgradeRequest()` function was stripping the upstream `x-forwarded-proto` and unconditionally re-injecting it as `http`. It now preserves the original value (e.g. `https` set by exe.dev) so that WebSocket connections also see the correct protocol.

### `lib/public-origin.ts` (new file)
Extracted the repeated `getPublicOrigin()` pattern into a single shared utility. Uses `x-forwarded-proto` and `x-forwarded-host` (falling back to `host` and the request URL) to return the correct public-facing origin string (e.g. `https://primordia.exe.xyz`). Compatible with both the standard Web API `Request` and Next.js `NextRequest`.

### `lib/evolve-sessions.ts`
- Renamed the `publicHostname` parameter of `startLocalEvolve()` to `publicOrigin`. It now expects a full origin string (`https://primordia.exe.xyz`) rather than a bare hostname.
- Preview URL construction no longer reads `REVERSE_PROXY_PORT` or builds its own `portSuffix`. It simply uses `${publicOrigin}/preview/${session.id}`, which is always correct because the origin is derived from the x-forwarded headers.

### `app/api/evolve/route.ts` and `app/api/evolve/from-branch/route.ts`
Replaced the ad-hoc `x-forwarded-host` extraction (which only captured the hostname, not the scheme or port) with a call to `getPublicOrigin(request)`. Passes the resulting full origin to `startLocalEvolve()`.

### `app/api/auth/cross-device/qr/route.ts` and `app/api/auth/exe-dev/route.ts`
Replaced the locally-defined `getPublicOrigin()` function in each file with an import from the new shared `lib/public-origin.ts` utility.

## Why

`REVERSE_PROXY_PORT` was being embedded into preview server URLs, QR code approval URLs, and redirect URLs. This caused issues when:
- The public port differed from the internal proxy port (e.g. the service is exposed on port 443 via exe.dev but `REVERSE_PROXY_PORT` is `3000`)
- The protocol was `https` but URLs were being generated with `http://`

The correct approach is to read the actual public proto/host/port from the x-forwarded headers that the upstream proxy (exe.dev) injects, and pass them faithfully down the chain so the Next.js app can use them to construct all public-facing URLs.
