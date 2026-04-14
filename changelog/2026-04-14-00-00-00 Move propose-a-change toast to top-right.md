# Move propose-a-change toast to top-right

## What changed

The "Request submitted!" toast notification in `EvolveSubmitToast` (inside `FloatingEvolveDialog.tsx`) was repositioned from the bottom-center of the screen to the top-right corner.

**Before:** `fixed bottom-6 left-1/2 -translate-x-1/2` (centered at bottom)  
**After:** `fixed top-6 right-6` (top-right corner)

The enter/exit animation direction was also updated to slide up/down (`-translate-y-2` on hidden) instead of the previous upward slide from `translate-y-2`.

## Why

The "Propose a change" floating dialog defaults to the bottom-right corner of the screen. Placing the toast in the top-right corner keeps it visually close to where the dialog lives without overlapping it, making the relationship between submitting a request and seeing the confirmation more intuitive.
