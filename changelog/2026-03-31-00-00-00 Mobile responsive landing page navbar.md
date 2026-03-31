# Mobile responsive landing page navbar

## What changed

- Extracted the landing page `<nav>` from `app/page.tsx` (a server component) into a new
  `components/LandingNav.tsx` client component.
- On **mobile** (`< sm` breakpoint) the Changelog, Login, and "Open app →" links are hidden
  and replaced with a hamburger button (☰). Tapping the button toggles a vertical dropdown
  menu below the top bar. Tapping any link in the dropdown closes the menu automatically.
- On **desktop** (`sm+`) the nav renders exactly as before — all links inline on the right.

## Why

The landing page navbar had no mobile handling: on small screens the three links and CTA
button were all crammed into a single row, causing overflow and a poor visual experience.
Tucking them behind a hamburger menu is the standard responsive pattern and keeps the top
bar uncluttered on narrow viewports.

## Files touched

| File | Change |
|---|---|
| `components/LandingNav.tsx` | **New** — `"use client"` component with hamburger toggle |
| `app/page.tsx` | Removed inline `<nav>` block; imports and renders `<LandingNav />` |
