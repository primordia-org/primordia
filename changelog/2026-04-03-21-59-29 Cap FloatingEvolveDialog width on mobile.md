# Cap FloatingEvolveDialog width on mobile

## What changed

Added `max-w-[calc(100vw-32px)]` to `FloatingEvolveDialog` in `components/FloatingEvolveDialog.tsx`.

## Why

The dialog was fixed at `w-[420px]`, which overflows the viewport on narrow mobile screens. The new `max-w` caps the dialog at the viewport width minus 32 px of breathing room, so it stays fully visible on phones without affecting the layout on wider screens.
