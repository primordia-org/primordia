# Fix login proceed button base path and use Lucide icon

## What changed

- Converted the "Proceed to Primordia →" button on the login screen from a `<button>` with `router.push()` to a `<Link>` component. Next.js `Link` automatically prepends `basePath`, so the navigation now works correctly when the app is hosted at a sub-path (e.g. `/preview/branch-name`).
- Replaced the `&rarr;` HTML entity with a Lucide `ArrowRight` icon, consistent with the project's icon convention.

## Why

The button was calling `router.push(nextUrl)` where `nextUrl` defaults to `/`. When the app runs under a `NEXT_BASE_PATH`, this produced a bare `/` URL that skipped the prefix, breaking navigation. Using `<Link>` fixes this transparently. The unicode arrow was also inconsistent with the rest of the codebase which uses Lucide icons.
