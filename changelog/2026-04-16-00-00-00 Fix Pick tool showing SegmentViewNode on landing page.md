# Fix Pick tool showing SegmentViewNode on landing page

## What changed

### `components/PageElementInspector.tsx`

- Added `INTERNAL_COMPONENT_NAMES` blocklist — a `Set` of Next.js App Router
  and React framework internals (e.g. `SegmentViewNode`, `InnerLayoutRouter`,
  `OuterLayoutRouter`, `AppRouter`, `HotReloader`, `ReactDevOverlay`, …) that
  are now skipped when walking the React fiber tree. Previously the very first
  named component encountered was always `SegmentViewNode`.

- Added `getDataComponentLabel(el)` — walks DOM ancestors looking for a
  `data-component` attribute injected by the SWC plugin (see below). Checked
  *before* the fiber walk so server-rendered components are identified
  correctly even though they have no client-side fiber entry.

- Updated `getReactComponentName`, `getReactComponentChain`, and the
  `generateFiberTreeText` root-finding loop to use both mechanisms.

### `swc-plugin-component-annotate` (new dependency)

Installed as a production dependency. The SWC Wasm plugin automatically adds
`data-component="<ComponentName>"` and `data-source-file="<filename>"` to the
root DOM element of every React component at compile time — including server
components, which never appear in the client-side fiber tree.

Configured in `next.config.ts` under `experimental.swcPlugins`:

```ts
experimental: {
  swcPlugins: [["swc-plugin-component-annotate", {}]],
},
```

Verified to work for **both** dev (Turbopack) and production (webpack/SWC)
builds. The landing page SSR HTML in dev contains:

```
data-component="HeroSection"
data-component="FeaturesSection"
data-component="FeatureCard"   (× 3)
data-component="HowItWorksSection"
data-component="HowItWorksStep"  (× 4)
data-component="CTABannerSection"
data-component="LandingFooter"
```

### `components/LandingSections.tsx` *(new file)*

Landing page sections extracted into named components so the Pick tool has
meaningful names to display. These are **server components** (no `"use client"`
— the SWC plugin provides the annotation, not the fiber tree):

| Export | Description |
|---|---|
| `HeroSection` | Hero with animated blobs, headline, and curl install command |
| `FeaturesSection` | Three-column feature grid; renders `FeatureCard` per item |
| `FeatureCard` | Individual feature card (internal named component) |
| `HowItWorksSection` | Four-step explainer; renders `HowItWorksStep` per step |
| `HowItWorksStep` | Individual step card (internal named component) |
| `CTABannerSection` | Bottom CTA banner with curl command |
| `LandingFooter` | Footer with nav links |

### `app/page.tsx`

Simplified to a thin server shell: calls `headers()` to build `curlCmd`,
then renders `<LandingNav>` and the five section components from
`LandingSections.tsx`. All the inline JSX moved to `LandingSections.tsx`.

## Why

The landing page was previously one large server component with all its JSX
inline. Server components don't appear in the client-side React fiber tree —
their DOM is owned by the Next.js internal `SegmentViewNode`, so the Pick
tool showed that name for every element on the page.

An earlier iteration made the sections `"use client"` components so they
would appear in the fiber tree. That worked but sacrificed server rendering.

The final solution uses `swc-plugin-component-annotate`: the SWC compiler
transforms each component's JSX at build time, adding `data-component`
attributes to the root element. These attributes survive into the server-
rendered HTML and are read by `getDataComponentLabel` in the inspector.
Server components keep their performance benefits; the Pick tool sees correct
component names everywhere.
