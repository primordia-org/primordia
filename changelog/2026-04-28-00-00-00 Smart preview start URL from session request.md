# Smart Preview Start URL from Session Request

## What changed

The Web Preview panel in evolve session pages now opens on the most relevant page for the session, instead of always defaulting to the app's landing page.

A new utility function `deriveSmartPreviewUrl` (in `lib/smart-preview-url.ts`) infers the best starting path from the session's initial request text using two strategies:

1. **Explicit route detection** — scans the request for a mention of a known route path (e.g. "fix the `/chat` page", "update `/admin/logs`"). If found, the matched path (with any sub-path) is appended to the preview base URL.

2. **Keyword matching** — falls back to a table of keyword phrases mapped to routes. For example, requests mentioning "admin panel", "server logs", or "rollback page" open `/admin`; requests mentioning "passkey" or "login flow" open `/login`; etc.

If neither strategy matches, the preview still opens on the landing page as before.

The computation is applied once when the preview URL first becomes available, so the user's in-panel navigation is not affected. Both the inline (mobile) and sidebar (desktop) preview panels benefit from the change.

## Why

Previously every session's Web Preview always started on the landing page regardless of what the request was about. For example, a request to "fix the /chat page styling" would open the landing page and the user would have to manually navigate. This change saves that navigation step and makes the preview immediately useful.
