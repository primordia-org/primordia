# Fix Admin Instance page dark theme and navbar

## What changed

`app/admin/instance/page.tsx` was using an old-style layout that differed from all other admin pages:

- Wrapped content in `<div className="min-h-screen bg-black text-white">` instead of the standard `<main className="flex flex-col w-full max-w-3xl mx-auto px-4 py-6 min-h-dvh">` used by every other admin page.
- Called `<PageNavBar currentPage="admin" />` without passing `subtitle`, `initialSession`, or evolve preference props (`initialHarness`, `initialModel`, `initialCavemanMode`, `initialCavemanIntensity`), causing the navbar to render in a degraded/weird state (no subtitle, hamburger menu not immediately visible, missing session context).
- Included a redundant `<h1>Admin</h1>` heading (the subtitle prop handles this in the shared nav).

## Fix

Updated `app/admin/instance/page.tsx` to match the pattern used by `/admin`, `/admin/logs`, and other admin sub-pages:

1. Replaced the old `<div>` wrapper with `<main className="flex flex-col ...">`.
2. Resolved `sessionUser` server-side and passed `subtitle="Admin"` + `initialSession` to `<PageNavBar>` so the navbar renders correctly on first paint.
3. Removed the redundant `<h1>` and the extra inner wrapper `<div>`.
4. Did **not** import `getEvolvePrefs` — the evolve harness/model/caveman prefs are optional on `PageNavBar` and pre-loading them would drag in `pi-model-registry.server.ts` → `@mariozechner/pi-coding-agent`, which Turbopack fails to resolve as an external in dev mode, causing a runtime crash. The `FloatingEvolveDialog` falls back to built-in defaults when those props are omitted.

## Why

The page appeared all-black and the navbar looked broken because the explicit `bg-black` class conflicted with the app's Tailwind dark-theme setup, and the stripped-down `PageNavBar` call produced a different-looking header than the rest of the admin section.
