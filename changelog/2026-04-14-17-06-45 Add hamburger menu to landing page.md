# Add hamburger menu to landing page

## What changed

- Replaced `components/LandingNav.tsx` with a minimal fixed-position wrapper: a single `HamburgerMenu` floating in the top-right corner (`fixed top-4 right-4 z-50`) — no navbar bar, no brand, no extra links.
- Added `<LandingNav />` to `app/page.tsx` — the landing page previously had no navigation at all.

## Why

The landing page lacked any navigation. A full navbar felt too heavy for the hero-focused design, so instead a subtle floating hamburger in the top-right corner gives visitors access to the session-aware standard menu (Go to chat, Propose a change, Admin/Shell for admins, sign in/out) without adding visual clutter.
