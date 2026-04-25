// lib/validate-canonical-url.ts
// Shared validation for the Canonical URL field.
// Used by the API route (server) and the admin UI (client).
//
// Rules:
//   - Empty string is valid (means "clear the value").
//   - Non-empty value must be a parseable URL.
//   - Protocol must be https:.
//   - Hostname must not be a localhost variant.

const LOCALHOST_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

/** Returns an error message string, or null if the value is valid. */
export function validateCanonicalUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null; // empty = clear, always valid

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "Canonical URL must be a valid URL";
  }

  if (parsed.protocol !== "https:") {
    return "Canonical URL must use HTTPS";
  }

  if (
    LOCALHOST_HOSTNAMES.has(parsed.hostname) ||
    parsed.hostname.endsWith(".localhost")
  ) {
    return "Canonical URL must not be a localhost address";
  }

  return null;
}


