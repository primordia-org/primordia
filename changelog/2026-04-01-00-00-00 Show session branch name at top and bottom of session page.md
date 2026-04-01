# Show session branch name at top and bottom of session page

## What changed

Added branch name visibility to `EvolveSessionView` in two places:

- **After "Your request"** — a "Created branch" card styled like the "Preview ready" amber card, showing a git branch icon, the label "Created branch", and the branch name on the next line in monospace. The Local Evolve Progress section follows immediately below.
- **Footer** — the branch name appears right-aligned on the same row as the "Changelog · Branches" navigation links, in a subtle dimmed amber monospace style.

The previous "BRANCH:" label that appeared as a separate element above the request card has been removed.

## Why

When multiple evolve sessions are open in different tabs (or when navigating back to an old session), it was hard to tell at a glance which branch the session was tracking. The branch name now appears at both ends of the page so it's always visible without scrolling. The new styling is more subtle and contextually integrated — no redundant label word, and the footer placement doesn't add a new visual row.
