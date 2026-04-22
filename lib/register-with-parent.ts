// lib/register-with-parent.ts
// Posts this instance's identity to its parent's /api/instance/register endpoint.
// Call this whenever the instance config changes (name, description, canonical URL)
// so the parent's graph stays up to date.
// Returns a human-readable status string for display in the admin UI.

import type { InstanceConfig } from "./db/types";

export async function registerWithParent(config: InstanceConfig): Promise<string> {
  const parentUrl = config.parentUrl.trim().replace(/\/$/, "");
  const canonicalUrl = config.canonicalUrl.trim().replace(/\/$/, "");

  if (!parentUrl || !canonicalUrl) return "";

  const body = {
    uuid7: config.uuid7,
    url: canonicalUrl,
    name: config.name,
    description: config.description || undefined,
  };

  try {
    const res = await fetch(`${parentUrl}/api/instance/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      return `Registered with parent at ${parentUrl}.`;
    }
    const text = await res.text().catch(() => res.statusText);
    return `Parent registration failed (${res.status}): ${text}`;
  } catch (err) {
    return `Parent registration error: ${String(err)}`;
  }
}
