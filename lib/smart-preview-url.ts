// lib/smart-preview-url.ts
// Infers the most relevant preview page path from a session request string.
// Used to open the Web Preview panel on the most contextually appropriate page
// rather than always defaulting to the landing page.

/**
 * Given the initial request text and the base preview URL (e.g. `/preview/my-branch`),
 * returns a URL pointing to the most relevant page within the preview.
 *
 * Strategy:
 * 1. Look for an explicit known-route path mentioned in the request
 *    (e.g. "fix the /chat page", "update /admin/logs").
 * 2. Fall back to keyword matching against known Primordia routes.
 * 3. Return the base URL unchanged if no match is found.
 */
export function deriveSmartPreviewUrl(request: string, basePreviewUrl: string): string {
  const lower = request.toLowerCase();

  // 1. Explicit route mention — find the first /known-route (with optional sub-path) in the text.
  const knownTopLevel = ['chat', 'evolve', 'admin', 'login', 'branches', 'changelog'];
  const explicitPattern = new RegExp(
    `\\/(${knownTopLevel.join('|')})(?:\\/[^\\s"')\`,.;:!?]*)?`,
    'i',
  );
  const explicitMatch = request.match(explicitPattern);
  if (explicitMatch) {
    // Strip trailing punctuation that may have been captured.
    const routePath = explicitMatch[0].replace(/[.,;:!?]+$/, '');
    return basePreviewUrl + routePath;
  }

  // 2. Keyword-to-route mapping — ordered from most-specific to least-specific.
  const rules: Array<{ keywords: string[]; route: string }> = [
    {
      keywords: [
        'chat interface', 'chat page', 'chat view', 'the chat',
        'chat window', 'chat box', 'chat input', 'chat message',
        'in the chat', 'on the chat',
      ],
      route: '/chat',
    },
    {
      keywords: [
        'login page', 'log in page', 'sign in page',
        'login flow', 'sign in flow', 'sign-in page',
        'passkey', 'authentication page', 'auth page', 'register page',
        'login screen', 'sign in screen',
      ],
      route: '/login',
    },
    {
      keywords: [
        'admin panel', 'admin page', 'admin area',
        'admin interface', 'admin section', 'admin tab',
        'server logs', 'proxy logs', 'rollback page',
        'server health',
      ],
      route: '/admin',
    },
    {
      keywords: [
        'branches page', 'branch page', 'branch list',
        'branch view', 'branch tree', 'branch table',
      ],
      route: '/branches',
    },
    {
      keywords: [
        'changelog page', 'change log page', 'changelog entry',
        'change log entry', 'release notes',
      ],
      route: '/changelog',
    },
    {
      keywords: [
        'evolve page', 'evolve form', 'propose a change',
        'submit a request', 'submit request', 'change request form',
      ],
      route: '/evolve',
    },
    {
      keywords: [
        'landing page', 'home page', 'homepage', 'front page',
        'main page', 'index page', 'splash page',
      ],
      route: '/',
    },
  ];

  for (const { keywords, route } of rules) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return route === '/' ? basePreviewUrl : basePreviewUrl + route;
    }
  }

  // 3. Default: return the base URL (landing page).
  return basePreviewUrl;
}
