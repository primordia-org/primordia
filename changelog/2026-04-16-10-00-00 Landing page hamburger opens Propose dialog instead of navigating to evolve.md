# Landing page hamburger opens Propose dialog instead of navigating to /evolve

## What changed

`LandingNav` now wires up the "Propose a change" hamburger menu item to open
the `FloatingEvolveDialog` inline — matching the behaviour on every other page
(`/chat`, `/changelog`, `/branches`).

Previously the landing page passed no `onEvolveClick` callback to
`buildStandardMenuItems`, so the menu item fell back to a hard navigation to
`/evolve`. This meant the Pick (element inspector) feature was unavailable from
the landing page.

The dialog is **dynamically imported** via `next/dynamic` with `ssr: false`, so
it is only fetched from the server when the user actually clicks "Propose a
change". The landing page's initial JS bundle is unchanged, keeping it fast and
mostly static.

## Why

Consistency: every page should be able to open the Propose dialog and use the
Pick feature without a full-page navigation. The landing page was the only
exception.
