# Use paperclip emoji for Attach files button

Replaced the inline SVG paperclip icon in the "Attach files" / "Attach" buttons with the 📎 emoji across `EvolveForm.tsx` and `FloatingEvolveDialog.tsx`.

The `EvolveSessionView.tsx` follow-up input already used the emoji, so all three attach buttons are now consistent.

This removes ~4 lines of SVG markup per button and keeps the UI visually consistent with the follow-up panel.
