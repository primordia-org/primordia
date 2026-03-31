# Cherry-pick mobile responsive navbar

## What changed

Cherry-picked commit `215161b` from the `mobile-responsive-navbar` branch onto the current branch.

This brings in the following changes (originally implemented on that branch):

- **`components/LandingNav.tsx`** (new) — `"use client"` component that renders the landing page top navigation. On mobile (`< sm` breakpoint) the links collapse behind a hamburger (☰) toggle button; tapping a link closes the menu automatically. On desktop (`sm+`) the nav is unchanged — all links display inline as before.
- **`app/page.tsx`** — Removes the inline `<nav>` block and replaces it with `<LandingNav />`. The `buildPageTitle` import and `generateMetadata` export (added after the original branch diverged) are preserved in the merge resolution.

## Why

The landing page navbar had no mobile handling: on small viewports the links and CTA button overflowed in a single cramped row. The hamburger-menu pattern is the standard responsive solution and keeps the top bar clean on narrow screens.
