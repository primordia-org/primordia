# Reduce code duplication with shared HamburgerMenu, StreamingDialog, and useSessionUser

## What changed

Three new shared building blocks were extracted from repeated inline code:

### `components/HamburgerMenu.tsx` (new)
The hamburger button, open/close state, click-outside handler, and dropdown JSX were copy-pasted identically across `ChatInterface`, `EvolveForm`, `EvolveSessionView`, and `PageNavBar` — roughly 90 lines each. This new component accepts `sessionUser`, `onLogout`, and an `items` array; the auth section (sign-in/sign-out) is always included internally, and each caller passes only its page-specific items.

### `components/StreamingDialog.tsx` (new)
`GitSyncDialog` and `PruneBranchesDialog` were structurally identical: same state machine (`idle → running → success/error`), same SSE streaming loop, same modal chrome (backdrop, panel, title bar, output area, footer buttons). The only differences were the title, icon, description text, action button colour, and API endpoint. `StreamingDialog` accepts those as props and both dialog components are now thin 30-line wrappers.

### `lib/hooks.ts` (new)
The session-fetch + logout pattern (`useState`, `useEffect` fetch on mount, `handleLogout` function) appeared verbatim in `ChatInterface`, `EvolveForm`, and `EvolveSessionView`. The `useSessionUser()` hook centralises this. The `SessionUser` type is also defined and exported from here, eliminating three local `interface SessionUser` definitions.

## Why

- The four hamburger menus and two streaming dialogs were pure copy-paste; any bug fix or style change had to be applied in multiple files.
- Net result: **816 lines deleted** from modified files, **539 lines added** (new files + slimmer call sites) = **net −277 lines** across the codebase.
- No behaviour changes — all refactoring is purely structural.
