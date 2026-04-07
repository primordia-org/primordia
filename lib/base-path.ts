// lib/base-path.ts
// Single source of truth for the app's base path.
//
// Use withBasePath() for:
//   - Client-side fetch() calls to internal API routes
//   - Plain <a href> or <img src> attributes pointing to internal paths
//
// Do NOT use for Next.js <Link> components, router.push(), or redirect() —
// those are all basePath-aware automatically when basePath is set in next.config.ts.

export const basePath: string = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Prefix a path with the configured base path. */
export function withBasePath(path: string): string {
  return `${basePath}${path}`;
}
