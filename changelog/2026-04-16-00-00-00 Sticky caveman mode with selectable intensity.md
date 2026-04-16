# Sticky caveman mode with selectable intensity

## What changed

- **Sticky caveman preference**: Caveman mode is now persisted as a user preference (alongside harness/model). Enabling or disabling it on one form saves the setting to the database and restores it on the next page load across all evolve entry points (the `/evolve` page, the floating "Propose a change" dialog, the session follow-up form, and the chat page).

- **Intensity selector**: When caveman mode is enabled, a dropdown appears alongside the checkbox letting you choose one of six intensity levels: `lite`, `full` (default), `ultra`, `wenyan-lite`, `wenyan-full`, `wenyan-ultra`. The selected intensity is included in the skill invocation (`/caveman <intensity>`) and is also persisted as a sticky preference.

## Why

The caveman checkbox previously defaulted to off on every page load and reset after each form submission, requiring the user to re-enable it on every request. Making it sticky (like harness and model) means users who prefer compressed output don't have to reconfigure it every time.

The intensity selector was added to make the existing intensity levels defined in the caveman skill actually accessible from the UI, rather than requiring manual text entry.

## Files changed

- `lib/user-prefs.ts` — added `PREF_CAVEMAN`, `PREF_CAVEMAN_INTENSITY`, `CAVEMAN_INTENSITIES`, `DEFAULT_CAVEMAN_INTENSITY`, updated `EvolvePrefs` interface and `getEvolvePrefs`
- `app/api/evolve/route.ts` — parses `cavemanMode` and `cavemanIntensity` from form data and persists them alongside harness/model
- `components/EvolveRequestForm.tsx` — adds `initialCavemanMode`/`initialCavemanIntensity` props, intensity dropdown UI, updated skill invocation string, removed caveman reset on submit
- `components/EvolveForm.tsx`, `components/FloatingEvolveDialog.tsx`, `components/PageNavBar.tsx`, `components/EvolveSessionView.tsx`, `components/ChatInterface.tsx` — threaded caveman props through
- `app/evolve/page.tsx`, `app/evolve/session/[id]/page.tsx`, `app/chat/page.tsx`, `app/branches/page.tsx`, all `app/admin/*/page.tsx`, `app/changelog/page.tsx` — pass caveman prefs from server
