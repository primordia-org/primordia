# Smart Preview Start URL from LLM Output

## What changed

The Web Preview panel in evolve session pages now opens on the most relevant page for the session, instead of always defaulting to the app's landing page.

### Agent prompt instruction (supply-side)

The evolve agent prompt (both initial and follow-up requests in `lib/evolve-sessions.ts`) now includes an explicit instruction:

> "In your final message, mention the path of the most relevant page to open in the preview, e.g. `The relevant page is at \`/api-docs\`.` Skip this step only if all changes are purely server-side or no single page is more relevant than the landing page."

This ensures the LLM reliably outputs a backtick-quoted path like `` `/api-docs` `` even for sessions where it would not naturally do so (e.g. sessions that add docs to an existing page rather than creating a brand-new route). The instruction is suppressed for internal automated runs (type-fix, conflict resolution) that are not user-facing.

### Path extraction (demand-side)

A new utility function `deriveSmartPreviewUrl` (in `lib/smart-preview-url.ts`) infers the best starting path by scanning the **LLM's text output** events from the session log. It collects all candidate path mentions across several regex patterns (priority order):

1. Backtick-quoted paths: `` `/path` ``
2. Markdown link targets: `[text](/path)`
3. Double/single-quoted paths: `"/path"` `'/path'`
4. Contextual phrases: "at /path", "available at /path", etc.

Each match is tagged with its position in the text, and the **last** one is returned — the LLM typically summarises results at the end of its output, so the final path mention is the most relevant.

Paths that are internal infrastructure (e.g. `/api/`, `/_next/`, `/lib/`, `/components/`) and paths that look like filenames (with file extensions) are excluded. If no valid path is found, the preview falls back to the landing page as before.

The smart URL is computed from the `events` state array in `EvolveSessionView`. By the time the dev server is ready and `WebPreviewPanel` mounts, the session events are complete, so the inferred path is stable. Both the inline (mobile) and sidebar (desktop) preview panels use the smart URL.

## Why

Previously the Web Preview always started on the landing page regardless of what the session built. Two problems compounded:

1. **Passive extraction alone is unreliable.** The LLM may not mention the preview path at all if it doesn't think to — as seen with the `post-body-params-docs` session, which added docs to `/api-docs` but never mentioned that path in its output.

2. **Matching against the initial request is also unreliable.** Requests describe what to change, not which URL to view.

The combined approach — instruct the LLM to state the path *and* parse it out of the output — makes the feature robust. For sessions that already naturally mention a path (like `ansi-escape-log-renderer` saying "The test page is at `/ansi-test`"), nothing changes. For sessions that don't, the explicit instruction fills the gap.
