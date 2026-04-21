# Add viewport meta tag for mobile responsiveness

## What changed
Added the Next.js `viewport` export to `app/layout.tsx` with `width=device-width, initialScale=1`.

## Why
Without this tag, mobile browsers default to a desktop-width virtual viewport (typically 980px), then scale the page down — making content appear tiny and causing horizontal overflow/scrolling. The session page and other pages were rendering wider than the screen on mobile devices. Adding the viewport meta tag tells browsers to use the actual device width and render at 1:1 scale, making Tailwind's responsive breakpoints work correctly.
