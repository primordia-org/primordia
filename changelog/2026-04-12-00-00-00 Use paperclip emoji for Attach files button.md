# Use paperclip emoji for Attach files button

Replaced the inline SVG paperclip icon with the 📎 emoji across all attach buttons, and standardized the label to "Attach files" in `EvolveForm.tsx`, `FloatingEvolveDialog.tsx`, and `EvolveSessionView.tsx`.

`FloatingEvolveDialog` previously said "Attach" while the other two said "Attach files"; all three now use the same wording.

This removes ~4 lines of SVG markup per button and keeps the UI visually consistent across all panels.
