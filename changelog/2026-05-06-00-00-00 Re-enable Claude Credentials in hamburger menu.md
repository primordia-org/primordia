# Re-enable Claude Credentials in hamburger menu + fix auth token routing

## What changed

### Re-enable the menu entry
The "Claude Credentials" menu item in the hamburger (☰) menu was previously commented out with a note saying claude-worker.ts used the Agent SDK which didn't support claude.ai subscriptions.

This change re-enables the menu item and its corresponding `<CredentialsDialog>` modal. The dialog already existed and was complete — it just wasn't reachable from the UI.

- Uncommented the `<MenuBtn>` for "Claude Credentials" in `components/HamburgerMenu.tsx`
- Added proper `trackEvent()` call to the button's onClick (consistent with the API Key button)
- Uncommented the `<CredentialsDialog>` render block below the menu

### Fix: only ever send one auth token per request

Previously both `encryptedApiKey` and `encryptedCredentials` could be sent together on the same evolve request. The client now only ever sends one:

- `encryptedCredentials` — when the selected harness is `claude-code` (the only harness that supports credentials.json)
- `encryptedApiKey` — for all other harnesses (e.g. `pi`)

This applies to both initial requests (`EvolveRequestForm.tsx`) and follow-up requests (`EvolveSessionView.tsx`).

The server-side `resolveAgentAuth()` still handles both defensively (credentials win for `claude-code`, API key wins for everything else), but it should now only ever receive one at a time.

### Fix: CredentialsDialog status check was localStorage-only

The "Active" status in the Claude Credentials dialog was determined solely by whether the browser's localStorage contained the AES encryption key. This caused a false-positive: if the server-side ciphertext was absent (DB reset, different device, user cleared server prefs) but the local AES key was still present, the dialog would show "Active" even though credentials could not actually be decrypted and sent.

- `CredentialsDialog` now fetches `GET /api/llm-key/encrypted-credentials` on mount and cross-checks the result.
- If the server reports `{ ciphertext: null }` while the local key exists, the orphaned key is cleared and the dialog shows "No credentials set".
- Added `clearOrphanedCredentialsKey()` helper to `lib/credentials-client.ts` so the dialog doesn't hardcode the localStorage key name.

## Why

Claude credentials (credentials.json / OAuth) are only meaningful for the `claude-code` harness — `pi` and other harnesses talk to the Anthropic API directly and can't use them. Sending both at once was unnecessary and confusing. The form now routes the right token to the right harness.

The false-positive status was misleading users into thinking credentials were active when they weren't, causing the gateway to be used silently on new devices/origins where the server-side ciphertext was missing.
