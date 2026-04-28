# Add BETA sticker to homepage

## What changed

Added a BETA disclaimer badge to the hero section of the landing page (`app/LandingSections.tsx`), positioned above the main "PRIMORDIA" headline.

The badge is an amber-coloured pill with:
- A pulsing dot indicator (using Tailwind's `animate-ping`) to draw the eye
- The text "Beta — not ready for prime time"
- A subtle amber glow shadow and semi-transparent amber background

## Why

Primordia is still early-stage software. Adding a visible beta disclaimer sets the right expectations for visitors and makes it clear the project is actively evolving.
