# Add owner mobile command shell at /oops

## What changed

- **New page `/oops`** (`app/oops/page.tsx`): owner-only shell page accessible to admin users. Non-admins see the standard `<ForbiddenPage>` explaining the requirement.
- **New API route `POST /api/oops`** (`app/api/oops/route.ts`): accepts `{ cmd: string }` in the request body, verifies the session is an admin, then runs the command with `spawn(cmd, [], { shell: true })` and streams stdout + stderr back as SSE events (`{ text }` chunks followed by a `{ done, exitCode }` terminal event). Unauthenticated requests get 401; non-admin gets 403. The child process is killed if the client disconnects.
- **New component `<OopsShell>`** (`components/OopsShell.tsx`): mobile-friendly client component. Shows a scrollable history of past command runs (prompt line, streamed output, exit status badge) above a sticky input bar. The input is a `<textarea>` with `autoCorrect`, `autoCapitalize`, and `spellCheck` disabled for a clean shell experience on iOS/Android. Enter submits; Shift+Enter inserts a newline.
- **Hamburger menu** (`components/HamburgerMenu.tsx`): added a "Shell" nav item (terminal icon, orange hover) pointing to `/oops`, visible only to admin users. Filtered out by the existing `currentPath` suppression when already on `/oops`.
- **Type updates** (`components/NavHeader.tsx`, `components/PageNavBar.tsx`): added `"oops"` to the `currentPage` union so the page can suppress self-referential menu links correctly.
- **PRIMORDIA.md** updated with the new page, API route, and component entries plus the feature in the Current Features table.

## Why

The owner (admin) needs to run occasional system commands — like `sudo systemctl restart primordia` — from a phone without having to SSH into the server. A dedicated mobile-friendly shell page is much more convenient than a full SSH client on mobile, while remaining safely locked behind the admin role check on both the page and the API route.
