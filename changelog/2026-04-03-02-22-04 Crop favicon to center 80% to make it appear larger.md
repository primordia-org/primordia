# Crop favicon to center 80% to make it appear larger

## What changed

Added `app/icon.png` — a center-cropped version of `public/primordia-logo.png` used exclusively as the browser favicon. The crop keeps the center 80% of the original 1024×1024 image (820×820 px, trimming ~102 px of transparent margin on each side), then Next.js App Router automatically serves it as the site favicon via the `app/icon.png` convention.

The main logo displayed on the landing page (`public/primordia-logo.png`) is unchanged.

## Why

The original logo has extra transparent padding around the icon graphic. When rendered at small favicon sizes (16×16, 32×32, or the browser tab icon), that padding made the actual graphic appear smaller than necessary. Trimming the transparent margin so the icon fills 80% of the frame makes the favicon look noticeably larger and crisper in browser tabs.
