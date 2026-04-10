// lib/public-origin.ts
// Shared utility for deriving the public-facing origin (scheme + host) from
// an incoming request, respecting x-forwarded-* headers set by upstream
// reverse proxies (exe.dev, our own reverse-proxy.ts, etc.).

/**
 * Returns the public-facing origin (e.g. "https://primordia.exe.xyz") for a
 * request, reading x-forwarded-proto and x-forwarded-host first, then falling
 * back to the Host header and the request URL itself.
 *
 * Compatible with both the standard Web API `Request` and Next.js `NextRequest`.
 */
export function getPublicOrigin(req: Request): string {
  const proto =
    req.headers.get("x-forwarded-proto") ??
    new URL(req.url).protocol.replace(/:$/, "");
  const host =
    req.headers.get("x-forwarded-host") ??
    req.headers.get("host") ??
    new URL(req.url).host;
  return `${proto}://${host}`;
}
