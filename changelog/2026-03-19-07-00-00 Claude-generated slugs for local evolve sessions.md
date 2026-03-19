# Claude-generated slugs for local evolve sessions

## What changed

Replaced the mechanical `toSlug()` function (which just took the first 5 words of the evolve request) with an async `generateSlug()` function that asks Claude to choose a short, descriptive kebab-case slug.

**File changed:** `app/api/evolve/local/route.ts`

- Removed `toSlug(text: string): string`
- Added `generateSlug(text: string): Promise<string>` — calls `claude-haiku-4-5` with a one-shot prompt asking for a 3–5 word kebab-case slug
- The response is sanitised (lowercased, non-`[a-z0-9-]` chars collapsed to hyphens) before use
- A first-5-words fallback is retained so slug generation never blocks session creation even if the API call fails

## Why

The old approach produced awkward slugs for requests that start with articles or filler words (e.g. "instead-of-using-the-first" for a request beginning with "instead of using…"). Claude picks a slug that actually reflects the intent of the change, making worktree paths and branch names much easier to read at a glance.
