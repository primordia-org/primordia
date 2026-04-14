# Round reload button during rotation in web preview

## What changed
The Reload (refresh) button in the `WebPreviewPanel` component now uses `rounded-full` (a circle) while it is spinning (`isLoading === true`), and reverts to the normal `rounded` (slightly rounded square) once loading finishes.

## Why
When a square button rotates it shows its corners sweeping in and out, which looks odd on mouse hover. Making the button fully circular during the spin animation keeps it visually contained and tidy.
