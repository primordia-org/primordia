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
 * Evolve session pages contain their own preview iframe. Loading one inside the
 * preview iframe creates a recursive browser-in-browser view, so session pages
 * are never valid preview targets.
 */
export function isRecursivePreviewUrl(value: string | null | undefined, sessionId?: string): boolean {
  if (!value) return false;

  try {
    const parsed = new URL(value, 'http://primordia.local');
    const pathname = parsed.pathname.replace(/\/+$/, '') || '/';

    if (pathname === '/evolve/session' || pathname.startsWith('/evolve/session/')) return true;

    const previewSessionPattern = sessionId
      ? new RegExp(`^/preview/${sessionId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/evolve/session(?:/|$)`)
      : /^\/preview\/[^/]+\/evolve\/session(?:\/|$)/;
    return previewSessionPattern.test(pathname);
  } catch {
    return false;
  }
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
    if (isRecursivePreviewUrl(event.path)) continue;
    return event.path === '/' ? base : `${base}${event.path}`;
  }

  return base;
}
