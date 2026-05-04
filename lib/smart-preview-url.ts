// lib/smart-preview-url.ts
// Infers the most relevant preview page path from LLM text output in session events.
// The LLM often names the page it built at the end of its response, e.g.:
//   "Done. The test page is at `/ansi-test` and offers: …"
// We scan all text events for path mentions and return the last one found,
// since the LLM tends to summarise results at the end of its output.

import type { SessionEvent } from './session-events';

// Paths that are internal infrastructure and should never be used as preview targets.
const EXCLUDED_PREFIXES = [
  '/api/',
  '/preview/',
  '/_next/',
  '/_',
  '/node_modules/',
  '/components/',
  '/lib/',
  '/scripts/',
  '/app/',
  '/public/',
];

// Path segment names that look like filenames rather than routes (have extensions).
const FILE_EXTENSION_RE = /\.[a-z]{1,5}$/i;

function isValidPreviewPath(p: string): boolean {
  if (!p || p === '/') return false;
  // Exclude internal prefixes.
  if (EXCLUDED_PREFIXES.some((x) => p.startsWith(x))) return false;
  // Exclude paths that look like filenames (e.g. `/foo.ts`, `/bar.tsx`).
  if (FILE_EXTENSION_RE.test(p)) return false;
  return true;
}

/**
 * Attempt to extract a page URL path from the LLM's text output.
 * Collects all candidate paths across multiple regex patterns, each tagged with
 * their position in the text so we can return the last one overall.
 */
function extractLastMentionedPath(text: string): string | null {
  // [position, path] tuples from all pattern matches.
  const candidates: Array<[number, string]> = [];

  const collect = (pattern: RegExp, groupIndex: number) => {
    // Run a fresh copy of the regex (avoid shared lastIndex state).
    const re = new RegExp(pattern.source, pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const p = m[groupIndex];
      if (p && isValidPreviewPath(p)) {
        candidates.push([m.index, p]);
      }
    }
  };

  // Patterns ordered from most to least reliable.
  // All use case-insensitive matching for paths.

  // 1. Backtick-quoted path: `/path` or `/path/sub`
  collect(/`(\/[a-z0-9][a-z0-9/_-]*)`/gi, 1);

  // 2. Markdown link target: [link text](/path)
  collect(/\[[^\]]+\]\((\/[a-z0-9][a-z0-9/_-]*)\)/gi, 1);

  // 3. Double-quoted path: "/path"
  collect(/"(\/[a-z0-9][a-z0-9/_-]*)"/gi, 1);

  // 4. Single-quoted path: '/path'
  collect(/'(\/[a-z0-9][a-z0-9/_-]*)'/gi, 1);

  // 5. Contextual phrases: "at /path", "page is at /path", "available at /path", etc.
  collect(/\b(?:at|to|visit|navigate to|available at|page(?:\s+is)?\s+at)\s+(\/[a-z0-9][a-z0-9/_-]*)/gi, 1);

  if (candidates.length === 0) return null;

  // Sort by position and return the path from the latest occurrence.
  candidates.sort((a, b) => a[0] - b[0]);
  return candidates[candidates.length - 1][1];
}

/**
 * Given session events (containing LLM text output) and the base preview URL
 * (e.g. `/preview/my-branch`), returns a URL pointing to the most relevant
 * page within the preview.
 *
 * Scans the LLM's text events for the last mentioned route path. The LLM
 * typically summarises what it built at the end of its response, e.g.:
 *   "Done. The test page is at `/ansi-test` and offers: …"
 * so the last path found is the most likely target page.
 *
 * Falls back to the base preview URL (landing page) if no path is detected.
 */
export function deriveSmartPreviewUrl(
  events: SessionEvent[],
  basePreviewUrl: string,
): string {
  // Concatenate all LLM text output in event order.
  const textContent = events
    .filter((e): e is Extract<SessionEvent, { type: 'text' }> => e.type === 'text')
    .map((e) => e.content)
    .join('');

  if (!textContent) return basePreviewUrl;

  const path = extractLastMentionedPath(textContent);
  return path ? basePreviewUrl + path : basePreviewUrl;
}
