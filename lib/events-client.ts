// lib/events-client.ts — client-side helper to track user events.
// Fire-and-forget: errors are swallowed so tracking never breaks the UI.
//
// Usage:
//   import { trackEvent } from "@/lib/events-client";
//   trackEvent("file-attachment-removed/v1", { source: "thread/remove-file-attachment", el: "button", trigger: "mouse" });

import { withBasePath } from "@/lib/base-path";

/**
 * Track a user action by posting to /api/events.
 * Safe to call from browser components — fire-and-forget, never throws.
 */
export function trackEvent(
  event: string,
  props?: Record<string, unknown> | null,
): void {
  fetch(withBasePath("/api/events"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, props: props ?? null }),
    // keepalive so the request survives page unload
    keepalive: true,
  }).catch(() => {
    // silently ignore — tracking must never break UX
  });
}

/**
 * Server-side or worker-side helper.
 * Accepts an optional userId when there is no session cookie.
 */
export async function appendEvent(
  event: string,
  props?: Record<string, unknown> | null,
  userId?: string | null,
): Promise<void> {
  try {
    await fetch(withBasePath("/api/events"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, props: props ?? null, userId: userId ?? null }),
    });
  } catch {
    // swallow
  }
}
