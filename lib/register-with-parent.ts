// lib/register-with-parent.ts
// Posts this instance's identity to its parent's /api/instance/register endpoint.
// Call this whenever the instance config changes (name, description, canonical URL)
// so the parent's graph stays up to date.
// Returns a human-readable status string for display in the admin UI.

import type { InstanceConfig } from "./db/types";

export async function registerWithParent(config: InstanceConfig): Promise<string> {
  const parentUrl = config.parentUrl.trim().replace(/\/$/, "");
  if (!parentUrl) return "";

  const canonicalUrl = config.canonicalUrl.trim().replace(/\/$/, "");

  const body: Record<string, string> = {
    uuid7: config.uuid7,
    name: config.name,
  };
  if (canonicalUrl) body.url = canonicalUrl;
  if (config.description) body.description = config.description;

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
