# Add header menu to /evolve page

## What changed

- Extracted `GitSyncDialog` from `components/ChatInterface.tsx` into its own shared file `components/GitSyncDialog.tsx`.
- Updated `components/ChatInterface.tsx` to import `GitSyncDialog` from the new shared file (no behaviour change).
- Updated `components/EvolveForm.tsx` to replace the simple "← Back to chat" link in the header with the same hamburger (☰) dropdown menu used on the `/chat` page.

The menu on `/evolve` contains:
- **Auth section** — shows signed-in username with a Sign out button, or a Log in link if not authenticated.
- **Go to chat** — navigates to `/chat` (equivalent to the old back-link, but now inside the menu).
- **Sync with GitHub** — opens the `GitSyncDialog` modal to pull + push the current branch, identical to the button available on `/chat`.

## Why

The `/evolve` page previously had no way to access auth controls or the GitHub sync feature — users had to go back to `/chat` to perform these actions. Making the header menu available on both pages gives a consistent experience across the app.
