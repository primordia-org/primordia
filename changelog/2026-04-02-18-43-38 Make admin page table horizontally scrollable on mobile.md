# Make admin page table horizontally scrollable on mobile

## What changed

Wrapped the permissions table in `AdminPermissionsClient.tsx` with an inner `overflow-x-auto` div so the table can be scrolled horizontally on narrow screens (mobile).

Previously, the table was clipped or squeezed inside the rounded border container, cutting off the grant/revoke buttons on small viewports.

## Why

On mobile the admin table had no horizontal scroll, making the rightmost "Grant/Revoke" action buttons unreachable. The fix adds an inner scroll container while keeping the outer rounded border box intact.
