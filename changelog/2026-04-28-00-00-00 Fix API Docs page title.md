# Fix API Docs page title

## What changed

Added `app/api-docs/layout.tsx` which exports a `generateMetadata` function returning `buildPageTitle("API Docs")` as the page `<title>`.

## Why

The API Docs page (`app/api-docs/page.tsx`) is a client component (`"use client"`), so Next.js App Router does not allow exporting `metadata` directly from it. Without a metadata export the browser tab showed the root layout's default title ("Primordia") instead of "API Docs". Adding a thin server-component layout wrapper in the same directory is the standard App Router pattern for providing metadata to client-component pages.
