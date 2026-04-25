// lib/auto-canonical.ts
// On the first request that reaches the server, if no canonical URL has been
// configured yet, derive one from the request's public origin (respecting
// x-forwarded-proto / x-forwarded-host) and persist it to the DB.
// That persistence triggers registerWithParent if a parent URL is set.
//
// Uses a module-level flag so the DB is only checked once per process.

import { getDb } from "./db";
import { registerWithParent } from "./register-with-parent";

let checked = false;

export async function ensureCanonicalUrl(origin: string): Promise<void> {
  if (checked) return;
  checked = true;

  try {
    const db = await getDb();
    const config = await db.getInstanceConfig();
    if (config.canonicalUrl) return; // already set — nothing to do

    // Only persist HTTPS non-localhost origins. The installer or other
    // internal tooling may hit the server over http://localhost:… first;
    // we must never lock that in as the canonical URL.
    try {
      const parsed = new URL(origin);
      const isLocalhost =
        parsed.hostname === "localhost" ||
        parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "::1" ||
        parsed.hostname.endsWith(".localhost");
      if (parsed.protocol !== "https:" || isLocalhost) {
        console.log(
          `[primordia] auto-canonical: skipping non-HTTPS or localhost origin: ${origin}`
        );
        checked = false; // try again on the next request
        return;
      }
    } catch {
      // Unparseable origin — skip.
      checked = false;
      return;
    }

    // Persist the derived origin as the canonical URL.
    await db.setInstanceConfig({ canonicalUrl: origin });

    // Re-fetch updated config so registerWithParent sees the new canonicalUrl.
    const updated = await db.getInstanceConfig();
    const status = await registerWithParent(updated);
    if (status) {
      console.log(`[primordia] Auto-detected canonical URL: ${origin}${status ? ` — ${status}` : ""}`);
    } else {
      console.log(`[primordia] Auto-detected canonical URL: ${origin}`);
    }
  } catch (err) {
    // Non-fatal — log and move on.
    console.warn("[primordia] auto-canonical: failed to set canonical URL:", err);
    // Reset flag so we try again on the next request.
    checked = false;
  }
}
