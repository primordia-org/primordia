# Remove "Start chatting" and "Propose a change" buttons from landing page

## What changed
Removed the two secondary CTA buttons ("Start chatting" and "Propose a change") from the hero section of the landing page (`app/page.tsx`). Also cleaned up the now-unused `ArrowRight` and `Edit` imports from `lucide-react`.

## Why
The buttons were deemed unnecessary on the landing page. The primary call-to-action (the curl install command) and the navigation bar already provide sufficient entry points into the app.
