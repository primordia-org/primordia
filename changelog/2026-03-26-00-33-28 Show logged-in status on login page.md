# Show logged-in status on login page

## What changed

The `/login` page now detects whether the visitor already has a valid session and, if so, displays an "already signed in" banner **instead** of the normal login form.

The banner shows:
- **"You're currently signed in as [username]"** — so the user knows which account is active.
- **"Proceed to Primordia →"** button — navigates to the intended destination (respects the `?next=` query param, defaulting to `/`).
- **"Log in as a different user"** button — dismisses the banner and reveals the normal passkey/QR login form so the user can authenticate as someone else.

While the session check is in flight (a single `GET /api/auth/session` request on mount), the normal login form is shown immediately — there is no loading spinner or blank state. Once the response comes back, if a session exists the form is smoothly replaced by the banner.

## Why

Previously, a logged-in user who navigated to `/login` (e.g. by following an old bookmark, or being redirected by a guard) would see the standard login form with no indication that they were already authenticated. This was confusing — it made it look like they were logged out when they weren't. The new banner gives clear, immediate feedback about the current auth state and offers the two most likely next actions.
