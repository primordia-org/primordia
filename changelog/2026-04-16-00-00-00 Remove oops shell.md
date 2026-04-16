# Remove /oops shell

## What changed

Removed the `/oops` admin shell feature entirely:

- Deleted `app/oops/page.tsx` — the page route
- Deleted `app/api/oops/route.ts` — the API endpoint that spawned shell commands and streamed output via SSE
- Deleted `components/OopsShell.tsx` — the client-side shell UI component
- Removed the "Shell" entry from the admin hamburger menu (`HamburgerMenu.tsx`)
- Removed `"oops"` from the `currentPage` union type in `NavHeader.tsx` and `PageNavBar.tsx`
- Removed `/oops/` from `public/robots.txt`
- Removed all references from `CLAUDE.md`

## Why

The `/oops` shell required `sudo` privileges to be useful (e.g. `sudo systemctl restart primordia`). Running Primordia with elevated privileges is a security concern, and the long-term plan is to operate with lower privileges.

In the meantime, [november-heron.exe.xyz](https://november-heron.exe.xyz/) serves the same purpose: it is a mobile-friendly Web Terminal that is more secure and more functional than the in-app shell.
