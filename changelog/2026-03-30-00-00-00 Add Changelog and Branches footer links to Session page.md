# Add Changelog and Branches footer links to Session page

## What changed

Added a small footer row to the bottom of the Evolve Session page (`/evolve/session/[id]`) containing "Changelog · Branches" navigation links, matching the style of the same links that appear in the `NavHeader` at the top of every page.

- **Changelog** link (`/changelog`) is always shown.
- **Branches** link (`/branches`) is shown only in `development` mode, consistent with how `NavHeader` gates it.

The change is confined to `components/EvolveSessionView.tsx`: the existing `{/* Footer actions */}` block was extended with a second row rendered as a `<p>` using `text-xs text-gray-500` and `text-blue-400 hover:text-blue-300` link styling — identical to the treatment in `NavHeader`.

## Why

Users on the Session page had no quick path to the Branches or Changelog pages — they had to navigate away via the header or the hamburger menu. A footer row mirrors the discoverability pattern already established at the top of every page without cluttering the primary UI.
