# Sticky Recent Login Tab

## What changed

`LoginPageInner` in `app/login/LoginClient.tsx` now remembers the last selected auth tab across visits.

- `activeTab` state initialiser reads `localStorage["primordia:lastLoginTab"]` on mount; falls back to the first plugin if the saved value is missing or no longer installed.
- A `useEffect` writes the current `activeTab` to `localStorage` whenever it changes.

## Why

Users who always use the same login method (e.g. Passkey) had to re-click their tab on every visit. Persisting the selection in `localStorage` removes that friction with minimal code.
