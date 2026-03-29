# Add navbar with menu to session page

## What changed

The evolve session page (`/evolve/session/[id]`, rendered by `EvolveSessionView.tsx`) previously had only a plain "← New request" text link in the header area. This has been replaced with the same hamburger menu that exists on the `/evolve` page (`EvolveForm.tsx`).

### New menu items on the session page

- **Auth section** — shows the signed-in username, or a "Log in" link if unauthenticated
- **Sign out** button (when authenticated)
- **New request** — navigates to `/evolve` to start a fresh evolve session
- **Go to chat** — navigates to `/chat`
- **Sync with GitHub** — opens the `GitSyncDialog` modal (git pull + push)

The menu closes when clicking outside it (via a `mousedown` listener on the document), matching the behaviour on the evolve form page.

## Why

The session page was the only authenticated page in the evolve flow that lacked the navigation menu, creating a dead-end UX where users had no quick way to sign out, switch to chat, or sync with GitHub while viewing a running session.
