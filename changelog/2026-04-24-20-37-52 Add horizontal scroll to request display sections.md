# Add horizontal scroll to request display sections

## What changed
Added `overflow-x: auto` CSS class to both the initial request ("Your request") and follow-up request sections in the evolve session view.

## Why
Long request text or error messages can exceed the container width, causing text to be cut off or overflow without a scrollbar. Adding `overflow-x: auto` enables horizontal scrolling when content exceeds the container width, improving readability and allowing users to see the full content without text being hidden.

## Files modified
- `app/evolve/session/[id]/EvolveSessionView.tsx`: Added `overflow-x-auto` to both request display divs (lines 459 and 1079)
