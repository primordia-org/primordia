# Re-enable Claude Credentials in hamburger menu

## What changed

The "Claude Credentials" menu item in the hamburger (☰) menu was previously commented out with a note saying the claude-worker.ts used the Agent SDK which didn't support claude.ai subscriptions.

This change re-enables the menu item and its corresponding `<CredentialsDialog>` modal. The dialog already existed and was complete — it just wasn't reachable from the UI.

- Uncommented the `<MenuBtn>` for "Claude Credentials" in `components/HamburgerMenu.tsx`
- Added proper `trackEvent()` call to the button's onClick (consistent with the API Key button)
- Uncommented the `<CredentialsDialog>` render block below the menu

## Why

We're actively working on getting Claude Code credentials working end-to-end. The dialog, encryption helpers (`lib/credentials-client.ts`), and backend storage route (`app/api/llm-key/encrypted-credentials/route.ts`) are all already in place — the menu entry just needed to be re-enabled so users can actually set their credentials.
