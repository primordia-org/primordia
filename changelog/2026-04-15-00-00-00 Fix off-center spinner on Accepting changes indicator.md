# Fix off-center spinner on "Accepting changes…" indicator

## What changed

Replaced the `⟳` Unicode character used as the spinner in the "Accepting changes…" and "Fixing type errors…" status indicators inside `EvolveSessionView.tsx` with a proper CSS border-based spinner (`<span>` with `rounded-full border-2 border-t-{color}` + `animate-spin`).

## Why

The `⟳` (U+27F3) glyph is not perfectly centered in its em square across all fonts and platforms, which causes it to wobble visibly when rotated by Tailwind's `animate-spin` class. A CSS border spinner is a perfect circle drawn entirely by the browser, so it rotates smoothly around its exact centre with no wobble.

The two affected statuses were:
- `accepting` — green "Accepting changes…" row
- `fixing-types` — amber "Fixing type errors… will auto-accept when complete." row
