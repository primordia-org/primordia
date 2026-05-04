# Shorten submit button label on mobile

## What changed
On small screens (`< sm` breakpoint), the "Submit Request" button in `EvolveRequestForm` now displays "Submit" instead of "Submit Request".

## Why
On narrow mobile viewports the full "Submit Request" label was too wide to fit on the same row as the "Attach" and "Pick" buttons, causing the layout to break. Shortening it to "Submit" keeps all three controls on one row without sacrificing clarity (the context makes the action obvious).
