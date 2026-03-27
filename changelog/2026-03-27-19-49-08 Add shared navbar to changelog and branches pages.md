# Add shared navbar to changelog and branches pages

## What changed

- Created `components/PageNavBar.tsx` — a new `"use client"` component that
  bundles `NavHeader` + a session-aware hamburger menu into a single header
  element. Used on pages that are not the primary chat or evolve views.

- Updated `components/NavHeader.tsx` — added an optional `currentPage` prop
  (`"changelog" | "branches"`) that suppresses self-referential nav links in
  the subtitle row (e.g. the changelog page no longer shows a redundant
  "Changelog" link).

- Updated `app/changelog/page.tsx` — replaced the hand-rolled `<header>` block
  with `<PageNavBar subtitle="Changelog" currentPage="changelog" />`.

- Updated `app/branches/page.tsx` — replaced the hand-rolled `<header>` block
  with `<PageNavBar subtitle="Local Branches" currentPage="branches" />`.

## Why

The changelog and branches pages had a minimal static header (title + "← Back
to app" link) that was inconsistent with the richer navbar found on the chat
and evolve pages. Users on those pages had no quick way to navigate, sign out,
or propose a change without going back to the home page first.

The hamburger menu in `PageNavBar` is session-aware: it is only rendered when
the user is logged in, keeping the header clean for unauthenticated visitors
while giving logged-in users full navigation options (sign out, go to chat,
propose a change, sync with GitHub).
