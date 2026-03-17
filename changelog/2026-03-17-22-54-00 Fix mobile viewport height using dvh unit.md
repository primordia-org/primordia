# Fix mobile viewport height using dvh unit

## What changed
Replaced `h-screen` (`height: 100vh`) with `h-dvh` (`height: 100dvh`) on the main chat container in `components/ChatInterface.tsx`.

## Why
On mobile browsers, `100vh` is calculated based on the full viewport height without browser chrome (address bar, on-screen keyboard). When the address bar is visible or the virtual keyboard is open, the actual visible area is smaller, causing the layout to overflow or clip incorrectly.

The CSS `dvh` (dynamic viewport height) unit adjusts dynamically as the browser UI appears and disappears, so `100dvh` always equals the current visible viewport height. Tailwind CSS v3.4+ ships `h-dvh` out of the box.
