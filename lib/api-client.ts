// lib/api-client.ts
//
// Typed HTTP client for the Primordia internal API.
//
// Built on openapi-fetch (a thin, ~6 kB wrapper around the native fetch API)
// with types generated from the OpenAPI spec via openapi-typescript.
// Zero runtime overhead — just types layered on top of native fetch.
//
// Usage (client components):
//   import { apiClient } from '@/lib/api-client';
//   const { data, error } = await apiClient.GET('/auth/session');
//   // `data` and `error` are fully typed from the OpenAPI spec.
//
// Usage (server components / API routes):
//   import { createApiClient } from '@/lib/api-client';
//   // Pass base URL if calling from a context without a global fetch base.
//   const client = createApiClient('http://localhost:3000/api');
//
// The client automatically prefixes paths with NEXT_PUBLIC_BASE_PATH (if set)
// so it works correctly when the app is mounted at a sub-path (e.g. /preview/{branch}).
//
// Regenerate lib/api-types.ts after changing the API:
//   bun run generate:api-docs && bun run generate:api-types

import createClient, { type Middleware } from 'openapi-fetch';
import type { paths } from './api-types';

// ---------------------------------------------------------------------------
// Base URL helpers
// ---------------------------------------------------------------------------

/**
 * Returns the base URL for the API client.
 *
 * - In the browser: relative path (empty string) so fetch() uses the current
 *   origin, with NEXT_PUBLIC_BASE_PATH prepended when the app is sub-mounted.
 * - In Node/Bun server contexts: must be provided explicitly as an argument
 *   because there is no implicit origin.
 */
function defaultBaseUrl(): string {
  const basePath: string =
    typeof process !== 'undefined'
      ? (process.env.NEXT_PUBLIC_BASE_PATH ?? '')
      : '';
  return `${basePath}/api`;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Create a typed API client pointing at the given base URL. */
export function createApiClient(baseUrl?: string) {
  return createClient<paths>({ baseUrl: baseUrl ?? defaultBaseUrl() });
}

// ---------------------------------------------------------------------------
// Shared browser client
// ---------------------------------------------------------------------------

/**
 * Pre-built typed API client for use in browser (client) components.
 *
 * Uses a relative base URL so it works at any domain and respects the
 * NEXT_PUBLIC_BASE_PATH sub-path mount when set.
 *
 * Do not use this in Server Components or API route handlers — those run
 * in Node/Bun where there is no implicit origin. Use `createApiClient(url)`
 * with an explicit base URL instead, or keep using the existing fetch()
 * helpers in server-only code.
 */
export const apiClient = createApiClient();

// Re-export the Middleware type so consumers can add fetch interceptors
// without importing from openapi-fetch directly.
export type { Middleware };
