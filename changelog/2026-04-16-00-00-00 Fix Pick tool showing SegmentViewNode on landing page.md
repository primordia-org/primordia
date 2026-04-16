# Fix Pick tool showing SegmentViewNode on landing page

## What changed

### `components/PageElementInspector.tsx`

- Added `INTERNAL_COMPONENT_NAMES` blocklist — a `Set` of Next.js App Router
  and React framework internals (e.g. `SegmentViewNode`, `InnerLayoutRouter`,
  `OuterLayoutRouter`, `AppRouter`, `HotReloader`, `ReactDevOverlay`, …) that
  are now skipped when walking the React fiber tree. Previously the very first
  named component encountered was always `SegmentViewNode`, which is the
  Next.js internal that wraps all server-rendered segments on the client.

- Updated `getReactComponentName`, `getReactComponentChain`, and the
  `generateFiberTreeText` root-finding loop to use the blocklist.

### `components/LandingSections.tsx` *(new file)*

Extracted every landing page section into a named `"use client"` component so
the Pick tool sees real React component names in the fiber tree — server
components don't appear there at all:

| Export | Description |
|---|---|
| `HeroSection` | Hero with animated blobs, headline, and curl install command |
| `FeaturesSection` | Three-column feature grid; renders `FeatureCard` per item |
| `FeatureCard` | Individual feature card (internal, named for the fiber tree) |
| `HowItWorksSection` | Four-step explainer; renders `HowItWorksStep` per step |
| `HowItWorksStep` | Individual step card (internal, named for the fiber tree) |
| `CTABannerSection` | Bottom CTA banner with curl command |
| `LandingFooter` | Footer with nav links |

### `app/page.tsx`

Simplified to a thin server shell: calls `headers()` to build `curlCmd`,
then renders `<LandingNav>` and the five section components from
`LandingSections.tsx`. All the JSX that used to live here is gone.

## Why

The landing page was previously one large server component with all its JSX
inline. Server components don't appear in the client-side React fiber tree —
their DOM is owned by the Next.js internal `SegmentViewNode`, so the Pick
tool showed that name for every element on the page.

The fix is to make the sections real client components (`"use client"`).
Client component fibers are present on the client and carry the correct
function name, so the Pick tool now shows `HeroSection`, `FeatureCard`,
`HowItWorksStep`, etc. The `data-component` DOM-attribute approach tried
earlier was rejected as misleading — it labels things as components when
they aren't — so it has been removed in favour of this proper refactor.

The blocklist in `PageElementInspector` is still useful as a backstop for
other pages that may have server-rendered sections the tool encounters.
