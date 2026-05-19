// lib/smart-preview-url.ts
// Selects the preview page from an explicit structured session event.
// Agents set this event by running `bun run set-preview-url /some-route` in the
// worktree; we intentionally do not infer paths from free-form text because
// that is ambiguous with file paths and prose.

import type { SessionEvent } from './session-events';

function normalizeBasePreviewUrl(basePreviewUrl: string): string {
  return basePreviewUrl.endsWith('/') && basePreviewUrl !== '/'
    ? basePreviewUrl.slice(0, -1)
    : basePreviewUrl;
}

function isSafePreviewPath(value: string): boolean {
  if (!value.startsWith('/')) return false;
  if (value.startsWith('//')) return false;
  if (value.includes('..')) return false;
  if (/\s/.test(value)) return false;
  return /^\/[A-Za-z0-9/_?=&.#%-]*$/.test(value);
}

/**
 * Returns the preview URL selected by the latest explicit `preview_path` event.
 * Falls back to the base preview URL (landing page) when no event has been set.
 */
export function deriveSmartPreviewUrl(
  events: SessionEvent[],
  basePreviewUrl: string,
): string {
  const base = normalizeBasePreviewUrl(basePreviewUrl);

  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type !== 'preview_path') continue;
    if (!isSafePreviewPath(event.path)) continue;
    return event.path === '/' ? base : `${base}${event.path}`;
  }

  return base;
}
