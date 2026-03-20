# Change initial commit message label to "Most recent change"

## What changed
- In `components/ChatInterface.tsx`, the on-load assistant message that shows the current commit info was updated from `"Ok, here's what's changed:\n\n..."` to `"Most recent change:\n\n..."`.

## Why
The previous phrasing "Ok, here's what's changed:" was conversational but slightly ambiguous — it sounded like something had just happened. "Most recent change:" is clearer and more accurate: it describes the last committed change to this build, not an event that just occurred.
